/** Approved Q6/Q7 evidence through the three public doors, using real auth and Postgres. */
import { createTRPCUntypedClient, httpLink } from '@trpc/client';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { idSchema, type Scope, type ShipId } from '@aeolus-fleet/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../src/app.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { applyNetworkRules, FLEET_URL, operatorCaller, secretOf } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

const leaseSchema = z.object({ id: idSchema('lease'), startedAt: z.iso.datetime() });
const receivedSchema = z.object({ deliveries: z.array(z.object({ deliveryId: idSchema('delivery'), messageId: idSchema('message'), senderLeaseId: idSchema('lease').nullable() })) });
const readSchema = z.object({ senderLeaseId: idSchema('lease').nullable() });
const pageSchema = z.object({ items: z.array(readSchema) });
type Door = 'REST' | 'tRPC' | 'MCP';
let core: PostgresCore;
let argo: ShipCaller;
let server: ReturnType<typeof createApp>;
let address: string;
let connections: Client[] = [];

beforeAll(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'evidence' })));
  server = createApp({ databaseUrl: core.databaseUrl, publicUrl: FLEET_URL, clock: core.clock, logger: false });
  address = await server.listen({ host: '127.0.0.1', port: 0 });
});
afterEach(async () => { await Promise.all(connections.map((connection) => connection.close())); connections = []; });
afterAll(async () => { await server.close(); await core.close(); });

async function crewed(scopes: Scope[] = []): Promise<{ crew: Crew; token: string }> {
  const name = `evidence-${newKey()}`;
  const ship = unwrap(await core.useCases.commissionShip(argo, { name, type: 'reviewer', scopes, idempotencyKey: newKey() }));
  return claim(ship.shipId, secretOf(ship.secret));
}
async function claim(shipId: ShipId, secret: string): Promise<{ crew: Crew; token: string }> {
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret, location: { kind: 'SERVER' }, harness: 'codex' }));
  return { crew: unwrap(await core.useCases.authenticate.byCrewToken(crewToken)), token: crewToken };
}

/** All three doors run the same procedure; return the unparsed output so evidence cannot be silently stripped in this test. */
async function call(door: Door, request: { token: string; path: string; input: Record<string, unknown>; isMutation?: boolean; onBehalfOf?: ShipId }): Promise<unknown> {
  const headers: Record<string, string> = { authorization: `Bearer ${request.token}` };
  if (request.onBehalfOf !== undefined) headers['aeolus-on-behalf-of'] = request.onBehalfOf;
  if (door === 'tRPC') {
    const client = createTRPCUntypedClient({ links: [httpLink({ url: `${address}/trpc`, headers })] });
    return request.isMutation ? client.mutation(request.path, request.input) : client.query(request.path, request.input);
  }
  if (door === 'REST') {
    const response = await fetch(`${address}/api/v1/${request.path.replace('.', '/')}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(request.input) });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body;
  }
  const client = new Client({ name: 'evidence-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers: request.onBehalfOf === undefined ? {} : { 'aeolus-on-behalf-of': request.onBehalfOf } } }));
  connections.push(client);
  const name = request.path.replace('ship.', '').replace('.', '_');
  const result = z.object({ isError: z.boolean().optional(), structuredContent: z.unknown().optional(), content: z.array(z.object({ type: z.literal('text'), text: z.string() })) }).parse(await client.callTool({ name, arguments: { ...request.input, crewToken: request.token } }));
  const text = result.content.map((block) => block.text).join('');
  if (result.isError) throw new Error(text);
  return result.structuredContent ?? JSON.parse(text);
}

for (const door of ['REST', 'tRPC', 'MCP'] as const) {
  describe(`${door} public evidence`, () => {
    it('keeps L1 on receive, redelivery and full reads after the sender becomes L2', async () => {
      // Given a confirmation under L1 and its first delivery to a reader.
      const sender = await crewed();
      const reader = await crewed(['fleet:read']);
      const instruction = unwrap(await core.useCases.sendMessage(reader.crew, { selector: { kind: 'ship', shipId: sender.crew.shipId }, payload: 'Take these instructions', model: 'gpt-6.1-sol', idempotencyKey: newKey() }));
      const input = { selector: { kind: 'ship', shipId: reader.crew.shipId }, inReplyTo: instruction.messageId, payload: 'Instructions accepted', model: 'gpt-6.1-sol', idempotencyKey: newKey() };
      const sent = z.object({ messageId: idSchema('message') }).parse(await call(door, { token: sender.token, path: 'ship.send', input, isMutation: true }));
      const first = receivedSchema.parse(await call(door, { token: reader.token, path: 'ship.receiveReply', input: { ...instruction }, isMutation: true }));
      unwrap(await core.useCases.releaseShip(argo, { shipId: sender.crew.shipId }));
      const prompt = unwrap(await core.useCases.getStartingPrompt(argo, { shipId: sender.crew.shipId }));
      const replacement = await claim(sender.crew.shipId, secretOf(prompt.secret));

      // When the replacement retries the key, the receiver sees it again, and reads it whole.
      expect(await call(door, { token: replacement.token, path: 'ship.send', input, isMutation: true })).toEqual(sent);
      const again = receivedSchema.parse(await call(door, { token: reader.token, path: 'ship.receive', input: {}, isMutation: true }));
      const deliveryId = first.deliveries[0]?.deliveryId;
      expect(deliveryId).toBeDefined();
      await call(door, { token: reader.token, path: 'ship.ack', input: { deliveryId }, isMutation: true });
      const reread = await call(door, { token: reader.token, path: 'ship.delivery', input: { deliveryId } });
      const record = pageSchema.parse(await call(door, { token: reader.token, path: 'ship.record', input: {}, isMutation: true }));
      const exchange = pageSchema.parse(await call(door, { token: reader.token, path: 'ship.exchange', input: { otherShipId: sender.crew.shipId } }));
      // fleet.message is a console tRPC read, not a REST or MCP ship call.
      const detail = door === 'tRPC'
        ? await call(door, { token: reader.token, path: 'fleet.message', input: { ...sent } })
        : unwrap(await core.useCases.readMessage(reader.crew, sent));
      const current = await call(door, { token: reader.token, path: 'fleet.ship', input: { shipId: sender.crew.shipId } });

      // Then the stored sending evidence stays L1, the authorised observation names L2, and ended auth gives no evidence.
      for (const message of [first.deliveries[0], again.deliveries[0], reread, record.items[0], exchange.items[0], detail]) expect(message).toMatchObject({ senderLeaseId: sender.crew.leaseId });
      expect(current).toMatchObject({ currentLease: { id: replacement.crew.leaseId, startedAt: core.clock.now().toISOString() } });
      expect(leaseSchema.parse(z.object({ currentLease: leaseSchema }).parse(current).currentLease).id).not.toBe(sender.crew.leaseId);
      await expect(call(door, { token: sender.token, path: 'fleet.ship', input: { shipId: sender.crew.shipId } })).rejects.toThrow();
      await expect(call(door, { token: sender.token, path: 'ship.send', input: { ...input, idempotencyKey: newKey() }, isMutation: true })).rejects.toThrow();
    });

    it('preserves L1 on a pushed delivery received after sender replacement', async () => {
      // Given a message accepted from L1 before any delivery.
      const sender = await crewed();
      const reader = await crewed();
      const message = unwrap(await core.useCases.sendMessage(sender.crew, { selector: { kind: 'ship', shipId: reader.crew.shipId }, payload: 'Confirmed', model: 'gpt-6.1-sol', idempotencyKey: newKey() }));
      unwrap(await core.useCases.releaseShip(argo, { shipId: sender.crew.shipId }));
      const prompt = unwrap(await core.useCases.getStartingPrompt(argo, { shipId: sender.crew.shipId }));
      const replacement = await claim(sender.crew.shipId, secretOf(prompt.secret));

      // When a computer side receives and receives again under a different lease.
      const first = await call(door, { token: reader.token, path: 'ship.pushReceive', input: { waker: 'adapter' }, isMutation: true });
      const again = await call(door, { token: reader.token, path: 'ship.pushReceive', input: {}, isMutation: true });

      // Then the evidence is the sending L1, never L2 or the receiving lease.
      for (const read of [first, again]) expect(receivedSchema.parse(read).deliveries).toEqual([expect.objectContaining({ messageId: message.messageId, senderLeaseId: sender.crew.leaseId })]);
      expect(sender.crew.leaseId).not.toBe(replacement.crew.leaseId);
      expect(sender.crew.leaseId).not.toBe(reader.crew.leaseId);
    });

    it('answers null for uncrewed, released, retired and remnant ships and for messages without sending evidence', async () => {
      // Given a reader and a ship not yet crewed.
      const reader = await crewed(['fleet:read']);
      const target = unwrap(await core.useCases.commissionShip(argo, { name: `uncrewed-${newKey()}`, type: 'reviewer', idempotencyKey: newKey() }));
      const read = () => call(door, { token: reader.token, path: 'fleet.ship', input: { shipId: target.shipId } });
      expect(await read()).toHaveProperty('currentLease', null);
      await claim(target.shipId, secretOf(target.secret));
      const sent = unwrap(await core.useCases.sendMessage(argo, { selector: { kind: 'ship', shipId: reader.crew.shipId }, payload: 'No sending crew', idempotencyKey: newKey() }));

      // When the target's crew is released and the ship retires and becomes a remnant.
      unwrap(await core.useCases.releaseShip(argo, { shipId: target.shipId }));
      const released = await read();
      unwrap(await core.useCases.retireShip(argo, { shipId: target.shipId }));
      const retired = await read();
      await core.prisma.ship.update({ where: { id: target.shipId }, data: { removedAt: core.clock.now() } });
      const remnant = await read();
      const received = receivedSchema.parse(await call(door, { token: reader.token, path: 'ship.receive', input: {}, isMutation: true }));
      const deliveryId = received.deliveries.find((delivery) => delivery.messageId === sent.messageId)?.deliveryId;
      await call(door, { token: reader.token, path: 'ship.ack', input: { deliveryId }, isMutation: true });
      const message = readSchema.parse(await call(door, { token: reader.token, path: 'ship.delivery', input: { deliveryId } }));

      // Then null describes absent evidence, never a confirmed crew.
      for (const ship of [released, retired, remnant]) expect(ship).toHaveProperty('currentLease', null);
      expect(message.senderLeaseId).toBeNull();
    });

    it('withholds current lease outside read reach, on behalf, without fleet:read and on the crew:run-only path', async () => {
      // Given a broad reader and an assigned runner beside a reader excluded by restricted rules.
      const reader = await crewed(['fleet:read', 'fleet:on-behalf']);
      const excluded = await crewed(['fleet:read']);
      const runner = await crewed(['crew:run']);
      const target = unwrap(await core.useCases.commissionShip(argo, { name: `assigned-${newKey()}`, type: 'reviewer', idempotencyKey: newKey() }));
      unwrap(await core.useCases.requestCrew(argo, { shipId: target.shipId, settings: {} }));
      unwrap(await core.useCases.assignCrew(argo, { shipId: target.shipId, trierarchShipId: runner.crew.shipId }));
      unwrap(await core.useCases.setOwner(argo, { shipId: target.shipId, ownerShipId: reader.crew.shipId }));
      // The reader owns the target; the excluded ship has no read allowance.
      await applyNetworkRules(core.useCases, { by: argo, rules: [] });

      // When each actor reads one target, including a privileged actor on behalf of the excluded ship.
      const outside = await call(door, { token: excluded.token, path: 'fleet.ship', input: { shipId: target.shipId } });
      const own = await call(door, { token: reader.token, path: 'fleet.ship', input: { shipId: target.shipId } });
      // MCP has no on-behalf credential contract; its connection headers carry no credentials.
      const onBehalf = door === 'MCP' ? outside : await call(door, { token: reader.token, onBehalfOf: excluded.crew.shipId, path: 'fleet.ship', input: { shipId: target.shipId } });
      const assigned = await call(door, { token: runner.token, path: 'fleet.ship', input: { shipId: target.shipId } });

      // Then omission means unavailable; no-scope auth refuses rather than disclosing evidence.
      expect(own).toHaveProperty('currentLease', null);
      expect(outside).not.toHaveProperty('currentLease');
      expect(onBehalf).not.toHaveProperty('currentLease');
      expect(assigned).toHaveProperty('crewRequest');
      expect(assigned).not.toHaveProperty('currentLease');
      const noRead = await crewed();
      await expect(call(door, { token: noRead.token, path: 'fleet.ship', input: { shipId: target.shipId } })).rejects.toThrow();
      await applyNetworkRules(core.useCases, { by: argo, rules: null });
    });
  });
}
