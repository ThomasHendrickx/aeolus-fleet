import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildHttpServer } from '../src/adapters/http/server.js';
import { addAgentShip, crewShip, FLEET_URL, historyUseCases, identityUseCases, initialiseFleet, messagingUseCases, registryUseCases } from './support/core-fixtures.js';
import { createInMemoryCore } from './support/in-memory.js';

const servers: FastifyInstance[] = [];
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

// The approved #2009 reproduction: another request under a used key names
// IDEMPOTENCY_KEY_REUSED at every door, keeping the refusal's message.
describe.each(['REST', 'MCP', 'tRPC'] as const)('%s idempotency refusals', (door) => {
  it.each(['commission', 'send'] as const)('names IDEMPOTENCY_KEY_REUSED for a changed %s request', async (call) => {
    // Given a crew allowed to commission and send, and a stored request.
    const core = createInMemoryCore('2026-09-30T12:00:00.000Z');
    const { fleetId } = await initialiseFleet(core);
    const { shipId } = addAgentShip(core, { fleetId, name: 'commissioner', scopes: ['fleet:commission', 'fleet:on-behalf', 'messages:send', 'messages:receive'] });
    const crewToken = crewShip(core, { fleetId, shipId });
    const server = buildHttpServer({ fleetUrl: FLEET_URL, useCases: { ...identityUseCases(core), ...registryUseCases(core), ...messagingUseCases(core), ...historyUseCases(core), ping: () => Promise.resolve({ serverTime: core.clock.now(), fleetCount: 1 }) }, checkDatabase: () => Promise.resolve(), latestMigration: () => Promise.resolve(null), clock: core.clock, logger: false });
    servers.push(server);
    const headers = { authorization: `Bearer ${crewToken}` };
    const input = call === 'commission'
      ? { name: 'helper', type: 'reviewer', ownerOf: shipId, ownership: 'requester', idempotencyKey: 'one-request' }
      : { selector: { kind: 'ship', name: 'argo' }, payload: 'First message', model: 'gpt-6.1-sol', idempotencyKey: 'one-request' };
    const changed = call === 'commission' ? { ...input, ownership: 'requester-owner' } : { ...input, payload: 'Another message' };
    const message = call === 'commission'
      ? 'This idempotency key was already used for another commission: commission with a new key'
      : 'This idempotency key was already used for another message: send a new message with a new key';
    const procedure = call === 'commission' ? 'fleet.commission' : 'ship.send';

    if (door === 'MCP') {
      const address = await server.listen({ host: '127.0.0.1', port: 0 });
      const client = new Client({ name: 'idempotency-test', version: '1.0.0' });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers } }));
      const name = call === 'commission' ? 'fleet_commission' : 'send';
      expect(await client.callTool({ name, arguments: { ...input, crewToken } })).not.toMatchObject({ isError: true });

      // When the same key names a different request.
      const refused = await client.callTool({ name, arguments: { ...changed, crewToken } });

      // Then the named refusal keeps its message.
      expect(refused).toMatchObject({ isError: true, content: [{ type: 'text', text: `IDEMPOTENCY_KEY_REUSED: ${message}` }] });
    } else {
      const url = door === 'REST' ? `/api/v1/${procedure.replace('.', '/')}` : `/trpc/${procedure}`;
      const body = (value: Record<string, unknown>) => value;
      expect((await server.inject({ method: 'POST', url, headers, payload: body(input) })).statusCode).toBe(200);

      // When the same key names a different request.
      const refused = await server.inject({ method: 'POST', url, headers, payload: body(changed) });

      // Then HTTP stays 409 and the named refusal keeps its message.
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject(door === 'REST'
        ? { code: 'IDEMPOTENCY_KEY_REUSED', message }
        : { error: { message, data: { refusal: 'IDEMPOTENCY_KEY_REUSED', httpStatus: 409 } } });
    }
  });
});
