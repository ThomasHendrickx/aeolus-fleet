import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import type { AppRouter } from '../src/index.js';
import { operatorCaller, secretOf } from '../src/testing/fleet.js';
import { unwrap } from '../src/testing/result.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

const TOKEN = 'journey-test-installation-token';
let core: PostgresCore;
let app: FastifyInstance;
let address: string;

function installation(token = TOKEN) {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc`, headers: { 'x-aeolus-installation-token': token } })] }).installation.fleets;
}

beforeAll(async () => {
  core = await createPostgresCore();
  app = createApp({ databaseUrl: core.databaseUrl, publicUrl: 'https://fleet.example.com', clock: core.clock, logger: false, installationToken: TOKEN });
  address = await app.listen({ host: '127.0.0.1', port: 0 });
});
afterAll(async () => { await app.close(); await core.close(); });

describe('hosting service fleet journey contract', () => {
  it('derives a linked round trip, isolates fleets and retains milestones after finished history expires', async () => {
    // Given a customer fleet with two actually crewed ships and an unrelated fleet.
    const fleet = unwrap(await core.useCases.initialiseFleet({ name: 'customer' }));
    const other = unwrap(await core.useCases.createFleet({ requestId: 'other', name: 'other', operatorEmail: 'other@example.com' }));
    const argo = operatorCaller(fleet);
    const a = unwrap(await core.useCases.commissionShip(argo, { name: 'a', type: 'builder', idempotencyKey: 'a' }));
    const b = unwrap(await core.useCases.commissionShip(argo, { name: 'b', type: 'builder', idempotencyKey: 'b' }));
    const claim = async (ship: typeof a) => {
      const { crewToken } = unwrap(await core.useCases.claimShip({ shipId: ship.shipId, secret: secretOf(ship.secret), location: { kind: 'CLOUD' }, harness: 'codex' }));
      return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
    };
    const alice = await claim(a);
    const bob = await claim(b);
    const original = unwrap(await core.useCases.sendMessage(alice, { selector: { kind: 'ship', shipId: b.shipId }, payload: 'private work', model: 'test', idempotencyKey: 'original' }));
    expect((await installation().get.query({ fleetId: fleet.fleetId })).journey?.milestones.find((fact) => fact.key === 'first-value')?.state).toBe('not-yet');

    // When the second ship replies explicitly and the finished history is later pruned.
    core.clock.advance(60_000);
    const occurredAt = core.clock.now().toISOString();
    const reply = { selector: { kind: 'ship' as const, shipId: a.shipId }, inReplyTo: original.messageId, payload: 'private reply', model: 'test', idempotencyKey: 'reply' };
    unwrap(await core.useCases.sendMessage(bob, reply));
    unwrap(await core.useCases.sendMessage(bob, reply));
    const before = await installation().get.query({ fleetId: fleet.fleetId });
    unwrap(await core.useCases.setFleetLimits({ fleetId: fleet.fleetId, retention: { kind: 'fleet', days: 1 } }));
    for (const caller of [alice, bob]) {
      const received = unwrap(await core.useCases.receiveDeliveries(caller, {}));
      for (const delivery of received.deliveries) unwrap(await core.useCases.acknowledgeDelivery(caller, { deliveryId: delivery.deliveryId }));
    }
    core.clock.advance(3 * 24 * 60 * 60 * 1000);
    await core.useCases.pruneHistory();

    // Then only this fleet reached First value; no content or party identifiers cross the journey API.
    const journey = (await installation().get.query({ fleetId: fleet.fleetId })).journey;
    expect(journey?.milestones.find((fact) => fact.key === 'first-value')).toMatchObject({ state: 'reached', occurredAt, definitionVersion: 'round-trip-v1' });
    expect(journey?.milestones).toEqual(before.journey?.milestones);
    expect((await installation().get.query({ fleetId: other.fleetId })).journey?.milestones.find((fact) => fact.key === 'first-value')?.state).toBe('not-yet');
    expect(JSON.stringify(journey)).not.toMatch(/private|sender|recipient|ship_|msg_/);
  });

  it('pages twenty fleet resources and safely replays a deletion-aware changes cursor behind installation authentication', async () => {
    // Given more fleets than a default page, including equal creation timestamps.
    for (let index = 0; index < 21; index += 1) unwrap(await core.useCases.createFleet({ requestId: `page-${index}`, name: `fleet-${index}`, operatorEmail: 'manager@example.com' }));
    // When the hosting service reads two pages and resumes after a saved changes cursor.
    const first = await installation().page.query({});
    const second = await installation().page.query({ cursor: first.nextCursor ?? undefined });
    const initial = await installation().changes.query({});
    let cursor = initial.nextCursor;
    while (cursor !== null) {
      const page = await installation().changes.query({ cursor });
      if (!page.hasMore) { cursor = page.nextCursor; break; }
      cursor = page.nextCursor;
    }
    const doomed = second.items[0];
    if (!doomed) throw new Error('Expected the second page to hold a fleet');
    unwrap(await core.useCases.deleteFleet({ requestId: 'delete-journey', fleetId: doomed.fleetId }));
    const changes = await installation().changes.query({ cursor: cursor ?? undefined });
    // Then stable pages never overlap, replay is safe, deletion is explicit, and another actor cannot read it.
    expect(first.items).toHaveLength(20);
    expect(second.items.every((item) => !first.items.some((seen) => seen.fleetId === item.fleetId))).toBe(true);
    expect(changes.items).toEqual([expect.objectContaining({ fleetId: doomed.fleetId, isDeleted: true, journey: null })]);
    expect(await installation().changes.query({ cursor: cursor ?? undefined })).toEqual(changes);
    await expect(installation('wrong').changes.query({})).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
    await expect(installation('wrong').page.query({})).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
  });
});
