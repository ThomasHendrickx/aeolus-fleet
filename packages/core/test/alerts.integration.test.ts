import { createIdGenerator, type FleetId, type RaiseAlertInput, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createRaiseAlert } from '../src/domain/registry/raise-alert.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';

// Alerts on a real Postgres (decision 0071, docs/design/monitoring 4.5):
// one per ship, signal and occurrence, with AlertRaised and AlertCleared in
// the same transaction. The slice's acceptance: two raises at once give one
// alert; a rollback leaves no event.

let core: PostgresCore;
let fleetId: FleetId;
let argo: ShipCaller;
let watch: ShipCaller;
let deployBotId: ShipId;

const DELIVERY_ID = 'dlv_01m66p4k2v9qz8f7x3n5c1d1v1';

function unacknowledged(): RaiseAlertInput {
  return {
    shipId: deployBotId,
    signal: 'delivery-unacknowledged',
    occurrenceKey: DELIVERY_ID,
    since: '2026-09-29T11:45:00.000Z',
    facts: { deliveryId: DELIVERY_ID, messageId: 'msg_01m66p4k2v9qz8f7x3n5c1msg1', state: 'pending', awaitingCrew: true, minutes: 15 },
  };
}

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' })));
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  const { shipId: watchId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'watch', type: 'watch', scopes: ['fleet:alert'] }));
  watch = { fleetId, shipId: watchId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:alert'] };
  ({ shipId: deployBotId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'deploy-bot', type: 'deployer' })));
});

afterEach(async () => {
  await core.close();
});

async function alertRows() {
  return core.prisma.alert.findMany({ where: { fleetId }, orderBy: { id: 'asc' }, select: { id: true, signal: true, occurrenceKey: true, clearedAt: true, clearedWhy: true } });
}

async function alertEvents() {
  return (await core.prisma.event.findMany({ where: { fleetId, type: { in: ['AlertRaised', 'AlertCleared'] } }, orderBy: { seq: 'asc' } })).map(({ type, shipId, actorShipId, details }) => ({ type, shipId, actorShipId, details }));
}

describe('alerts on Postgres', () => {
  it('keeps the alert as raised, read back with its facts, with AlertRaised caused by the watch', async () => {
    const raised = unwrap(await core.useCases.raiseAlert(watch, unacknowledged()));

    await expect(createPrismaUnitOfWork(core.prisma).run(async (tx) => ({ isOk: true as const, value: await tx.alerts.find(fleetId, raised.id) }))).resolves.toEqual({
      isOk: true,
      value: {
        ...unacknowledged(),
        fleetId,
        id: raised.id,
        ownerShipId: argo.shipId,
        since: new Date('2026-09-29T11:45:00.000Z'),
        raisedAt: core.clock.now(),
        cleared: null,
      },
    });
    await expect(alertEvents()).resolves.toEqual([
      { type: 'AlertRaised', shipId: deployBotId, actorShipId: watch.shipId, details: { alertId: raised.id, signal: 'delivery-unacknowledged', occurrenceKey: DELIVERY_ID } },
    ]);
  });

  it('gives one alert for two raises of one occurrence at once: the second waits, then answers the alert the first raised, and one AlertRaised', async () => {
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      alerts: {
        ...tx.alerts,
        findByOccurrence: async (fleet, occurrence) => {
          await hold();
          return tx.alerts.findByOccurrence(fleet, occurrence);
        },
      },
    }));
    const first = createRaiseAlert({ uow, clock: core.clock, ids: createIdGenerator() })(watch, unacknowledged());
    await reached;

    const second = core.useCases.raiseAlert(watch, unacknowledged());

    const [firstRaised, secondRaised] = [unwrap(await first), unwrap(await second)];
    expect(secondRaised).toEqual(firstRaised);
    await expect(alertRows()).resolves.toEqual([{ id: firstRaised.id, signal: 'delivery-unacknowledged', occurrenceKey: DELIVERY_ID, clearedAt: null, clearedWhy: null }]);
    await expect(alertEvents()).resolves.toHaveLength(1);
  });

  it('gives one alert for many raises of one occurrence at once, each answering it', async () => {
    const raises = await Promise.all(Array.from({ length: 5 }, () => core.useCases.raiseAlert(watch, unacknowledged())));

    expect(new Set(raises.map((raised) => unwrap(raised).id)).size).toBe(1);
    await expect(alertRows()).resolves.toHaveLength(1);
    await expect(alertEvents()).resolves.toHaveLength(1);
  });

  it('rolls back a raise that fails before commit: no alert and no event', async () => {
    const failing = createRaiseAlert({
      uow: { run: (work) => createPrismaUnitOfWork(core.prisma).run((tx) => work({ ...tx, events: { append: () => Promise.reject(new Error('the server failed before commit')) } })) },
      clock: core.clock,
      ids: createIdGenerator(),
    });

    await expect(failing(watch, unacknowledged())).rejects.toThrow('the server failed before commit');
    await expect(alertRows()).resolves.toEqual([]);
    await expect(alertEvents()).resolves.toEqual([]);
  });

  it('clears an open alert with AlertCleared, and a retire clears the open ones left, the ship retired', async () => {
    const cleared = unwrap(await core.useCases.raiseAlert(watch, unacknowledged()));
    const left = unwrap(await core.useCases.raiseAlert(watch, { ...unacknowledged(), occurrenceKey: 'dlv_01m66p4k2v9qz8f7x3n5c1d1v2' }));
    core.clock.advance(60_000);

    unwrap(await core.useCases.clearAlert(watch, { alertId: cleared.id }));
    unwrap(await core.useCases.retireShip(argo, { shipId: deployBotId }));

    await expect(alertRows()).resolves.toEqual([
      { id: cleared.id, signal: 'delivery-unacknowledged', occurrenceKey: DELIVERY_ID, clearedAt: core.clock.now(), clearedWhy: 'cleared' },
      { id: left.id, signal: 'delivery-unacknowledged', occurrenceKey: 'dlv_01m66p4k2v9qz8f7x3n5c1d1v2', clearedAt: core.clock.now(), clearedWhy: 'retired' },
    ]);
    const events = await alertEvents();
    expect(events.map(({ type }) => type)).toEqual(['AlertRaised', 'AlertRaised', 'AlertCleared', 'AlertCleared']);
    expect(events.slice(2)).toEqual([
      { type: 'AlertCleared', shipId: deployBotId, actorShipId: watch.shipId, details: { alertId: cleared.id, signal: 'delivery-unacknowledged', why: 'cleared' } },
      { type: 'AlertCleared', shipId: deployBotId, actorShipId: argo.shipId, details: { alertId: left.id, signal: 'delivery-unacknowledged', why: 'retired' } },
    ]);
  });

  it("reads the fleet's open alerts newest first a page at a time, a ship's on its page, and the count on each listed ship", async () => {
    const oldest = unwrap(await core.useCases.raiseAlert(watch, unacknowledged()));
    core.clock.advance(1_000);
    const cleared = unwrap(await core.useCases.raiseAlert(watch, { ...unacknowledged(), occurrenceKey: 'b' }));
    core.clock.advance(1_000);
    const newest = unwrap(await core.useCases.raiseAlert(watch, { ...unacknowledged(), occurrenceKey: 'c' }));
    unwrap(await core.useCases.clearAlert(watch, { alertId: cleared.id }));

    const first = await core.useCases.readOpenAlerts(argo, { limit: 1 });
    const second = await core.useCases.readOpenAlerts(argo, { limit: 1, cursor: first.nextCursor ?? undefined });
    const deployBot = unwrap(await core.useCases.getShip(argo, { shipId: deployBotId }));
    const listed = (await core.useCases.listFleet(argo)).ships.find((ship) => ship.id === deployBotId);

    expect([first.items, first.nextCursor]).toEqual([[newest], newest.id]);
    expect([second.items, second.nextCursor]).toEqual([[oldest], null]);
    expect('openAlerts' in deployBot ? deployBot.openAlerts.map(({ id }) => id) : undefined).toEqual([newest.id, oldest.id]);
    expect(listed && 'openAlertCount' in listed ? listed.openAlertCount : undefined).toBe(2);
  });
});
