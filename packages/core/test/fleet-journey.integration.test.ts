import { SCOPES, createIdGenerator, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createApp } from '../src/app.js';
import type { AppRouter } from '../src/index.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { secretOf } from '../src/testing/fleet.js';
import { unwrap } from '../src/testing/result.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

/** The installation-created fleet's operator, with the authority its console holds. */
function operatorCaller(fleet: { fleetId: FleetId; operatorShipId: ShipId }): ShipCaller {
  return { fleetId: fleet.fleetId, shipId: fleet.operatorShipId, kind: 'operator', scopes: [...SCOPES] };
}

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
    const [alice, bob] = await Promise.all([claim(a), claim(b)]);
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

  it('excludes infrastructure, pings, self messages and acknowledgements, and requires crew at both sends', async () => {
    // Given one crewed customer agent, one not yet crewed agent and a plugin.
    const fleet = unwrap(await core.useCases.createFleet({ requestId: 'qualification', name: 'qualification', operatorEmail: 'manager@example.com' }));
    const argo = operatorCaller(fleet);
    const a = unwrap(await core.useCases.commissionShip(argo, { name: 'a', type: 'builder', idempotencyKey: 'a' }));
    const b = unwrap(await core.useCases.commissionShip(argo, { name: 'b', type: 'builder', idempotencyKey: 'b' }));
    const plugin = unwrap(await core.useCases.commissionShip(argo, { name: 'plugin', type: 'plugin', kind: 'plugin', idempotencyKey: 'plugin' }));
    const claim = async (ship: typeof a) => {
      const { crewToken } = unwrap(await core.useCases.claimShip({ shipId: ship.shipId, secret: secretOf(ship.secret), location: { kind: 'CLOUD' } }));
      return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
    };
    const alice = await claim(a);
    const service = await claim(plugin);
    // When infrastructure and self traffic is accepted, none of it proves customer messaging.
    unwrap(await core.useCases.sendMessage(argo, { selector: { kind: 'ship', shipId: a.shipId }, payload: 'administration', idempotencyKey: 'argo' }));
    unwrap(await core.useCases.sendMessage(service, { selector: { kind: 'ship', shipId: a.shipId }, payload: 'notice', idempotencyKey: 'plugin' }));
    unwrap(await core.useCases.sendMessage(alice, { selector: { kind: 'ship', shipId: a.shipId }, payload: 'self', model: 'test', idempotencyKey: 'self' }));
    unwrap(await core.useCases.pingShip(argo, { shipId: a.shipId }));
    expect((await installation().get.query({ fleetId: fleet.fleetId })).journey?.milestones.find((fact) => fact.key === 'first-message')?.state).toBe('not-yet');
    // And when a real message was sent before its recipient was crewed, then acknowledged and replied to.
    const original = unwrap(await core.useCases.sendMessage(alice, { selector: { kind: 'ship', shipId: b.shipId }, payload: 'work', model: 'test', idempotencyKey: 'work' }));
    core.clock.advance(60_000);
    const bob = await claim(b);
    const received = unwrap(await core.useCases.receiveDeliveries(bob, {}));
    for (const delivery of received.deliveries) unwrap(await core.useCases.acknowledgeDelivery(bob, { deliveryId: delivery.deliveryId }));
    unwrap(await core.useCases.sendMessage(bob, { selector: { kind: 'ship', shipId: a.shipId }, inReplyTo: original.messageId, payload: 'reply', model: 'test', idempotencyKey: 'reply' }));
    // Then acceptance is First message, but the earlier missing crew prevents First value.
    const journey = (await installation().get.query({ fleetId: fleet.fleetId })).journey;
    expect(journey?.milestones.find((fact) => fact.key === 'first-message')?.state).toBe('reached');
    expect(journey?.milestones.find((fact) => fact.key === 'first-value')?.state).toBe('not-yet');
  });

  it('recognises the original send time when a type delivery identifies its customer recipient later', async () => {
    // Given two crewed customer ships and a message addressed to the second ship's type.
    const fleet = unwrap(await core.useCases.createFleet({ requestId: 'type-fleet', name: 'type fleet', operatorEmail: 'manager@example.com' }));
    const argo = operatorCaller(fleet);
    const a = unwrap(await core.useCases.commissionShip(argo, { name: 'writer', type: 'writer', idempotencyKey: 'writer' }));
    const b = unwrap(await core.useCases.commissionShip(argo, { name: 'reader', type: 'reader', idempotencyKey: 'reader' }));
    const claim = async (ship: typeof a) => {
      const { crewToken } = unwrap(await core.useCases.claimShip({ shipId: ship.shipId, secret: secretOf(ship.secret), location: { kind: 'CLOUD' } }));
      return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
    };
    const alice = await claim(a);
    const bob = await claim(b);
    const sentAt = core.clock.now().toISOString();
    const original = unwrap(await core.useCases.sendMessage(alice, { selector: { kind: 'type', type: 'reader' }, payload: 'private', model: 'test', idempotencyKey: 'to-type' }));
    // When the recipient is known three days later and replies explicitly.
    core.clock.advance(3 * 86_400_000);
    unwrap(await core.useCases.receiveDeliveries(bob, {}));
    const repliedAt = core.clock.now().toISOString();
    unwrap(await core.useCases.sendMessage(bob, { selector: { kind: 'ship', shipId: a.shipId }, inReplyTo: original.messageId, payload: 'private reply', model: 'test', idempotencyKey: 'type-reply' }));
    // Then the original source time and late computation stay distinct, and the reply proves value.
    const journey = (await installation().get.query({ fleetId: fleet.fleetId })).journey;
    expect(journey?.milestones.find((fact) => fact.key === 'first-message')).toMatchObject({ state: 'reached', occurredAt: sentAt, computedAt: repliedAt });
    expect(journey?.milestones.find((fact) => fact.key === 'first-value')).toMatchObject({ state: 'reached', occurredAt: repliedAt });
  });

  it('rolls back projection and cursor with a failed source transaction and expires idle activity in bounded maintenance', async () => {
    // Given a fleet with its durable initial projection and a customer ship without a lease.
    const ids = createIdGenerator();
    const fleet = unwrap(await core.useCases.createFleet({ requestId: 'rollback-fleet', name: 'rollback', operatorEmail: 'manager@example.com' }));
    const a = unwrap(await core.useCases.commissionShip(operatorCaller(fleet), { name: 'source', type: 'builder', idempotencyKey: 'source' }));
    const before = await installation().get.query({ fleetId: fleet.fleetId });
    const changes = await installation().changes.query({});
    // When a transaction fails after its source lease, events and projection have all been written.
    await expect(core.prisma.$transaction(async (db) => {
      const tx = createPrismaTx(db, core.clock);
      await tx.leases.open({ id: ids('lease'), fleetId: fleet.fleetId, shipId: a.shipId, location: { kind: 'CLOUD', description: null }, harness: 'codex', crewTokenHash: null, startedAt: core.clock.now(), endedAt: null });
      await tx.events.append({ id: ids('event'), fleetId: fleet.fleetId, type: 'ShipClaimed', occurredAt: core.clock.now(), actor: { kind: 'ship', shipId: a.shipId }, shipId: a.shipId, details: {} });
      await tx.events.flush();
      throw new Error('forced source failure');
    })).rejects.toThrow('forced source failure');
    // Then both the projection and its changes cursor are unchanged, and no source lease survives.
    expect((await installation().get.query({ fleetId: fleet.fleetId })).journey).toEqual(before.journey);
    expect(await installation().changes.query({})).toEqual(changes);
    expect(await core.prisma.lease.count({ where: { fleetId: fleet.fleetId, shipId: a.shipId } })).toBe(0);

    // Given retained activity in an otherwise idle projection.
    await core.prisma.$executeRaw`UPDATE fleet_journeys SET data = jsonb_set(data, '{activityDates}', '["2026-01-01"]'::jsonb), activity_expires_at = '2026-04-01'::timestamptz WHERE fleet_id = ${fleet.fleetId}`;
    // When the independent maintenance task runs.
    await core.useCases.expireJourneyActivity();
    // Then expired dates are physically removed while milestone facts remain.
    const [stored] = await core.prisma.$queryRaw<{ dates: unknown }[]>`SELECT data->'activityDates' AS dates FROM fleet_journeys WHERE fleet_id = ${fleet.fleetId}`;
    expect(stored?.dates).toEqual([]);
    expect((await installation().get.query({ fleetId: fleet.fleetId })).journey?.milestones).toEqual(before.journey?.milestones);
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
