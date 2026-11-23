/** Issue #2036: the public meeting calls carry goal and deadline facts. */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { addAgentShip, crewShip, FLEET_URL, historyUseCases, identityUseCases, initialiseFleet, messagingUseCases, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { buildHttpServer } from './server.js';

function fixture() {
  const core = createInMemoryCore('2026-11-23T10:00:00.000Z');
  const server = buildHttpServer({ fleetUrl: FLEET_URL, useCases: {
    ...identityUseCases(core), ...registryUseCases(core), ...messagingUseCases(core), ...historyUseCases(core),
    ping: () => Promise.resolve({ serverTime: core.clock.now(), fleetCount: 1 }),
  }, clock: core.clock, logger: false, checkDatabase: () => Promise.resolve(), latestMigration: () => Promise.resolve(null), consoleOrigin: 'https://fleet.example.com' });
  return { core, server };
}
let held: ReturnType<typeof fixture>;
let token: string;
let client: Client;
beforeEach(async () => {
  held = fixture();
  const { fleetId } = await initialiseFleet(held.core);
  const { shipId } = addAgentShip(held.core, { fleetId, name: 'chair', scopes: ['meetings:open', 'messages:send', 'messages:receive'] });
  const alpha = addAgentShip(held.core, { fleetId, name: 'alpha' });
  crewShip(held.core, { fleetId, shipId: alpha.shipId });
  token = crewShip(held.core, { fleetId, shipId });
  const address = await held.server.listen({ host: '127.0.0.1', port: 0 });
  client = new Client({ name: 'meeting-goal', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`)));
});
afterEach(async () => { await client.close(); await held.server.close(); });

type Door = 'tRPC' | 'REST' | 'MCP';
async function call(door: Door, { name, input }: { name: 'openMeeting' | 'meeting' | 'openCall' | 'send'; input: Record<string, unknown> }) {
  if (door === 'MCP') {
    const result = z.object({ structuredContent: z.unknown().optional(), isError: z.boolean().optional(), content: z.array(z.object({ text: z.string() })) }).parse(await client.callTool({ name, arguments: { ...input, crewToken: token } }));
    return result.isError ? { refusal: result.content.map((part) => part.text).join(' ') } : { data: result.structuredContent };
  }
  const response = await held.server.inject(door === 'REST' ? {
    method: 'POST', url: `/api/v1/ship/${name}`, headers: { authorization: `Bearer ${token}` }, payload: input,
  } : name !== 'meeting' ? {
    method: 'POST', url: `/trpc/ship.${name}`, headers: { authorization: `Bearer ${token}` }, payload: input,
  } : { method: 'GET', url: `/trpc/ship.meeting?input=${encodeURIComponent(JSON.stringify(input))}`, headers: { authorization: `Bearer ${token}` } });
  if (response.statusCode !== 200) return { refusal: response.body };
  return { data: door === 'REST' ? z.unknown().parse(response.json()) : z.object({ result: z.object({ data: z.unknown() }) }).parse(response.json()).result.data };
}
const anOpen = () => ({ ships: [{ name: 'alpha' }], idempotencyKey: 'open-goal', model: SESSION_MODEL, goal: 'Agree the release date', endsAt: '2026-11-23T10:01:00.000Z' });
describe.each<Door>(['tRPC', 'REST', 'MCP'])('%s meeting goal and end time', (door) => {
  it('opens and reads a meeting with its goal and future end time', async () => {
    // Given a crewed opener with a goal and future end time.
    const input = anOpen();
    // When it opens and reads the meeting.
    const { meetingId } = z.object({ meetingId: z.string() }).parse((await call(door, { name: 'openMeeting', input })).data);
    const result = await call(door, { name: 'meeting', input: { meetingId } });
    // Then both facts cross the public call boundary intact.
    expect(result.data).toMatchObject({ goal: 'Agree the release date', endsAt: '2026-11-23T10:01:00.000Z' });
  });
  it.each([{ goal: 'a'.repeat(201) }, { endsAt: '2026-11-23T09:59:59.999Z' }, { endsAt: '2026-11-23T10:00:00.000Z' }])('refuses an invalid goal or deadline and stores nothing: %j', async (change) => {
    // Given a request outside the approved boundaries.
    const input = { ...anOpen(), ...change };
    // When the opener calls it.
    const result = await call(door, { name: 'openMeeting', input });
    // Then it is BAD_REQUEST and no part of the open is stored.
    expect(result.refusal).toContain('BAD_REQUEST');
    expect(held.core.state.meetings).toEqual([]);
    expect(held.core.state.messages).toEqual([]);
  });
});


describe.each<Door>(['tRPC', 'REST', 'MCP'])('%s meeting calls', (door) => {
  async function openedCall() {
    const { meetingId } = z.object({ meetingId: z.string() }).parse((await call(door, { name: 'openMeeting', input: anOpen() })).data);
    const opened = await call(door, { name: 'openCall', input: { meetingId, question: 'Friday?', idempotencyKey: 'call-friday', model: SESSION_MODEL, deadline: '2026-11-23T10:00:30.000Z' } });
    return { meetingId, callId: z.object({ callId: z.string() }).parse(opened.data).callId };
  }
  it('opens a moderator call with its fixed expected list', async () => {
    const { meetingId, callId } = await openedCall();
    expect(callId).toMatch(/^msg_/);
    const read = await call(door, { name: 'meeting', input: { meetingId, callId } });
    expect(read.data).toMatchObject({ call: { callId, deadline: '2026-11-23T10:00:30.000Z', closedAt: null, answers: [] } });
  });
  it('reads silent ships and a late answer outside the closed round', async () => {
    // Given an expected chair that missed the call deadline, before maintenance runs.
    const { meetingId, callId } = await openedCall();
    held.core.clock.advance(30_000);
    // When its answer crosses the public boundary at the deadline.
    const sent = await call(door, { name: 'send', input: { selector: { kind: 'meeting', meetingId }, callId, payload: 'Late Friday', model: SESSION_MODEL, idempotencyKey: 'late-chair-answer' } });
    const { messageId } = z.object({ messageId: z.string() }).parse(sent.data);
    // Then it remains readable, marked late and outside the closed round.
    const read = await call(door, { name: 'meeting', input: { meetingId, callId } });
    expect(read.data).toMatchObject({ call: { closedAt: '2026-11-23T10:00:30.000Z', answers: [], lateAnswers: [{ messageId, isLate: true, payload: 'Late Friday' }] }, contributions: { items: [{ messageId, isLate: true }] } });
    expect(z.object({ call: z.object({ silentShipIds: z.array(z.string()) }) }).parse(read.data).call.silentShipIds).toHaveLength(2);
  });
  it('accepts an answer and reads it in the named call', async () => {
    const { meetingId, callId } = await openedCall();
    const sent = await call(door, { name: 'send', input: { selector: { kind: 'meeting', meetingId }, callId, payload: 'Friday', model: SESSION_MODEL, idempotencyKey: 'chair-answer' } });
    const { messageId } = z.object({ messageId: z.string() }).parse(sent.data);
    const read = await call(door, { name: 'meeting', input: { meetingId, callId } });
    expect(read.data).toMatchObject({ call: { answers: [{ messageId, payload: 'Friday', callId }] } });
  });
  it('does not deliver an individual answer', async () => {
    const { meetingId, callId } = await openedCall();
    const before = held.core.state.deliveries.length;
    await call(door, { name: 'send', input: { selector: { kind: 'meeting', meetingId }, callId, payload: 'Friday', model: SESSION_MODEL, idempotencyKey: 'chair-answer' } });
    expect(held.core.state.deliveries).toHaveLength(before);
  });
  it('refuses reading an unknown call', async () => {
    const { meetingId } = await openedCall();
    expect((await call(door, { name: 'meeting', input: { meetingId, callId: held.core.ids('message') } })).refusal).toContain('NOT_FOUND');
  });
  it.each([
    ['a deadline past the meeting end', { deadline: '2026-11-23T10:01:00.001Z' }],
    ['an oversized question', { question: 'a'.repeat(65_537), deadline: '2026-11-23T10:00:30.000Z' }],
  ])('refuses %s without storing a call', async (_restriction, change) => {
    const { meetingId } = z.object({ meetingId: z.string() }).parse((await call(door, { name: 'openMeeting', input: anOpen() })).data);
    const before = held.core.state.messages.length;
    expect((await call(door, { name: 'openCall', input: { meetingId, question: 'Friday?', idempotencyKey: 'invalid-call', model: SESSION_MODEL, ...change } })).refusal).toContain('BAD_REQUEST');
    expect(held.core.state.messages).toHaveLength(before);
  });
});
