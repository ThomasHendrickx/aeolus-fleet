/** #2038 at each public door: the authenticated participant marks contributions read. */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { addAgentShip, agentCaller, crewShip, FLEET_URL, historyUseCases, identityUseCases, initialiseFleet, messagingUseCases, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { buildHttpServer } from './server.js';

function fixture() {
  const core = createInMemoryCore();
  const server = buildHttpServer({ fleetUrl: FLEET_URL, useCases: {
    ...identityUseCases(core), ...registryUseCases(core), ...messagingUseCases(core), ...historyUseCases(core),
    ping: () => Promise.resolve({ serverTime: core.clock.now(), fleetCount: 1 }),
  }, clock: core.clock, logger: false, checkDatabase: () => Promise.resolve(), latestMigration: () => Promise.resolve(null), consoleOrigin: 'https://fleet.example.com' });
  return { core, server };
}
let held: ReturnType<typeof fixture>;
let address: string;
let token: string;
let strangerToken: string;
let client: Client;
let input: { meetingId: string; messageId: string };
beforeEach(async () => {
  held = fixture();
  const { fleetId } = await initialiseFleet(held.core);
  const chief = agentCaller({ fleetId, ...addAgentShip(held.core, { fleetId, name: 'chief', scopes: ['messages:send', 'meetings:open'] }) });
  const reader = addAgentShip(held.core, { fleetId, name: 'reader', scopes: ['messages:receive'] });
  const stranger = addAgentShip(held.core, { fleetId, name: 'stranger', scopes: ['messages:receive'] });
  token = crewShip(held.core, { fleetId, shipId: reader.shipId });
  strangerToken = crewShip(held.core, { fleetId, shipId: stranger.shipId });
  const messaging = messagingUseCases(held.core);
  const { meetingId } = unwrap(await messaging.openMeeting(chief, { ships: [{ shipId: reader.shipId }], idempotencyKey: newKey(), model: SESSION_MODEL }));
  const { messageId } = unwrap(await messaging.sendMessage(chief, { selector: { kind: 'meeting', meetingId }, payload: 'Read this', idempotencyKey: newKey(), model: SESSION_MODEL }));
  input = { meetingId, messageId };
  address = await held.server.listen({ host: '127.0.0.1', port: 0 });
  client = new Client({ name: 'meeting-reader', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`)));
});
afterEach(async () => { await client.close(); await held.server.close(); });

type Door = 'tRPC' | 'REST' | 'MCP';
async function call(door: Door, body: Record<string, unknown> = input, credential = token) {
  if (door === 'MCP') {
    const result = z.object({ structuredContent: z.unknown().optional(), isError: z.boolean().optional(), content: z.array(z.object({ text: z.string() })) }).parse(await client.callTool({ name: 'ackMeetingUpTo', arguments: { ...body, crewToken: credential } }));
    return result.isError ? { refusal: result.content.map((part) => part.text).join(' ') } : { data: result.structuredContent };
  }
  const response = await held.server.inject({ method: 'POST', url: door === 'REST' ? '/api/v1/ship/ackMeetingUpTo' : '/trpc/ship.ackMeetingUpTo', headers: { authorization: `Bearer ${credential}` }, payload: body });
  if (response.statusCode !== 200) return { refusal: response.body };
  return { data: door === 'REST' ? z.unknown().parse(response.json()) : z.object({ result: z.object({ data: z.unknown() }) }).parse(response.json()).result.data };
}

describe.each<Door>(['tRPC', 'REST', 'MCP'])('%s meeting read acknowledgement', (door) => {
  it('acknowledges the authenticated participant contribution once and preserves its added notice', async () => {
    // Given a contribution waiting for this crew.
    // When it marks through that contribution and repeats.
    const first = await call(door);
    const again = await call(door);
    // Then it receives counts of one and zero, with the added notice still pending.
    expect(first).toEqual({ data: { acknowledged: 1 } });
    expect(again).toEqual({ data: { acknowledged: 0 } });
    expect(held.core.state.deliveries.map((delivery) => delivery.state)).toEqual(['pending', 'acknowledged']);
  });
  it('refuses a non-participant despite participant identity supplied in input', async () => {
    // Given a valid token for a ship outside the meeting.
    // When it supplies another ship identity in the request.
    const result = await call(door, { ...input, shipId: held.core.state.ships.find((ship) => ship.name === 'reader')?.id }, strangerToken);
    // Then it is refused without acknowledging anything.
    expect(result.refusal).toContain('NOT_FOUND');
    expect(held.core.state.deliveries.every((delivery) => delivery.state === 'pending')).toBe(true);
  });
  it('refuses a missing receive scope and an ended lease before changing deliveries', async () => {
    // Given the stored reader ship has no receive scope.
    for (const ship of held.core.state.ships) if (ship.name === 'reader') ship.scopes = [];
    // When its crew attempts the mark and later its lease ends.
    const forbidden = await call(door, { ...input, scopes: ['messages:receive'] });
    for (const lease of held.core.state.leases) lease.endedAt = held.core.clock.now();
    const ended = await call(door);
    // Then server facts decide both refusals and no delivery changes.
    expect(forbidden.refusal).toContain('FORBIDDEN');
    expect(ended.refusal).toContain('LEASE_ENDED');
    expect(held.core.state.deliveries.every((delivery) => delivery.state === 'pending')).toBe(true);
  });
});
