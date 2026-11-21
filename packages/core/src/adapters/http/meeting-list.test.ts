/** Meeting-list acceptance at all three doors, using the server's stored actor. */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { addAgentShip, crewShip, FLEET_URL, historyUseCases, identityUseCases, initialiseFleet, messagingUseCases, registryUseCases } from '../../../test/support/core-fixtures.js';
import { aMeetingForList } from '../../../test/support/meeting-list-scenarios.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
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
let client: Client;
beforeEach(async () => {
  held = fixture();
  const { fleetId } = await initialiseFleet(held.core);
  const { shipId } = addAgentShip(held.core, { fleetId, name: 'reader' });
  token = crewShip(held.core, { fleetId, shipId });
  const openedAt = held.core.clock.now();
  for (let n = 0; n < 3; n += 1) {
    held.core.state.meetings.push(aMeetingForList({ fleetId, shipId, ownerId: shipId, moderatorId: shipId, otherId: shipId }, {
      serial: n, openedAt, micHolderShipId: null, micRequests: [],
      participants: [{ shipId, joinedAt: openedAt, leftAt: null, isRevoked: false }],
    }));
  }
  address = await held.server.listen({ host: '127.0.0.1', port: 0 });
  client = new Client({ name: 'meeting-reader', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`)));
});
afterEach(async () => { await client.close(); await held.server.close(); });

type Door = 'tRPC' | 'REST' | 'MCP';

async function call(door: Door, input: Record<string, unknown> = {}) {
  if (door === 'MCP') {
    const result = z.object({ structuredContent: z.unknown().optional(), isError: z.boolean().optional(), content: z.array(z.object({ text: z.string() })) }).parse(await client.callTool({ name: 'meetings', arguments: { ...input, crewToken: token } }));
    return result.isError ? { refusal: result.content.map((part) => part.text).join(' ') } : { page: result.structuredContent };
  }
  const response = await held.server.inject(door === 'REST' ? {
    method: 'POST', url: '/api/v1/ship/meetings', headers: { authorization: `Bearer ${token}` }, payload: input,
  } : { method: 'GET', url: `/trpc/ship.meetings?input=${encodeURIComponent(JSON.stringify(input))}`, headers: { authorization: `Bearer ${token}` } });
  if (response.statusCode !== 200) return { refusal: response.body };
  return { page: door === 'REST' ? z.unknown().parse(response.json()) : z.object({ result: z.object({ data: z.unknown() }) }).parse(response.json()).result.data };
}
const pageSchema = z.object({ items: z.array(z.object({ meetingId: z.string(), title: z.string(), openedAt: z.iso.datetime(), participantState: z.literal('present') })), nextCursor: z.string().nullable() });
describe.each<Door>(['tRPC', 'REST', 'MCP'])('%s meeting list', (door) => {
  it('answers a bounded page and continues using the opaque cursor', async () => {
    // Given three meetings readable by this crew.
    // When it asks for two and then passes the cursor back.
    const first = pageSchema.parse((await call(door, { limit: 2 })).page);
    const second = pageSchema.parse((await call(door, { limit: 2, cursor: first.nextCursor })).page);
    // Then every meeting appears once and the last cursor is null.
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((item) => item.meetingId)).size).toBe(3);
    expect(second.nextCursor).toBeNull();
  });
  it.each([{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { cursor: 'forged' }])('refuses invalid paging as BAD_REQUEST: %j', async (input) => {
    // Given a live crew.

    // When paging is invalid.
    const result = await call(door, input);

    // Then the door refuses it.
    expect(result.refusal).toContain('BAD_REQUEST');
  });
  it('refuses LEASE_ENDED before reading', async () => {
    // Given this crew was released.
    for (const lease of held.core.state.leases) lease.endedAt = held.core.clock.now();
    // When it reads.
    const result = await call(door);

    // Then its former token is refused.
    expect(result.refusal).toContain('LEASE_ENDED');
  });
  it('refuses FORBIDDEN using server scopes despite scopes supplied in input', async () => {
    // Given the stored ship no longer holds messages:receive.
    for (const ship of held.core.state.ships) if (ship.name === 'reader') ship.scopes = [];
    // When it claims the scope in input.
    const result = await call(door, { scopes: ['messages:receive'] });

    // Then server facts still refuse it.
    expect(result.refusal).toContain('FORBIDDEN');
  });
});
