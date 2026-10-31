import { createIdGenerator, type FleetId, type ReportTask, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createSetExpectations } from '../src/domain/registry/set-expectations.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

// Expectations on a real Postgres (decision 0071, docs/design/monitoring
// 4.7): set on the ship, read back with it, with ExpectationsSet in the same
// transaction; a rollback leaves nothing; a retire removes them.

let core: PostgresCore;
let fleetId: FleetId;
let argo: ShipCaller;
let mergerId: ShipId;

const PULL_REQUEST: ReportTask = { kind: 'url', url: 'https://github.com/ThomasHendrickx/aeolus-fleet/pull/1391' };
const SIX_PM = new Date('2026-09-29T18:00:00.000Z');

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' })));
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  ({ shipId: mergerId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'merger-1', type: 'merger' })));
});

afterEach(async () => {
  await core.close();
});

async function expectationsRows() {
  return core.prisma.shipExpectations.count({ where: { fleetId } });
}

async function expectationsEvents() {
  return (await core.prisma.event.findMany({ where: { fleetId, type: 'ExpectationsSet' }, orderBy: { seq: 'asc' } })).map(({ shipId, actorShipId, details }) => ({ shipId, actorShipId, details }));
}

async function expectationsOnMerger() {
  const ship = unwrap(await core.useCases.getShip(argo, { shipId: mergerId }));
  return 'expectations' in ship ? ship.expectations : undefined;
}

describe('expectations on Postgres', () => {
  it('keeps them on the ship, read back with it, each with who set it and when, with ExpectationsSet caused by the setter', async () => {
    unwrap(await core.useCases.setExpectations(argo, { shipId: mergerId, reportChangesWithin: 60, taskDoneBy: { task: PULL_REQUEST, doneBy: SIX_PM } }));

    const setBy = { kind: 'ship', shipId: argo.shipId };
    await expect(expectationsOnMerger()).resolves.toEqual({
      reportChangesWithin: { minutes: 60, setBy, setAt: core.clock.now() },
      taskDoneBy: { task: PULL_REQUEST, doneBy: SIX_PM, setBy, setAt: core.clock.now() },
    });
    await expect(expectationsEvents()).resolves.toEqual([
      { shipId: mergerId, actorShipId: argo.shipId, details: { reportChangesWithin: 60, taskDoneBy: SIX_PM.toISOString(), taskKind: 'url' } },
    ]);
  });

  it('clears one set to null, keeping the other, and holds no row once both are cleared', async () => {
    unwrap(await core.useCases.setExpectations(argo, { shipId: mergerId, reportChangesWithin: 60, taskDoneBy: { task: PULL_REQUEST, doneBy: SIX_PM } }));

    unwrap(await core.useCases.setExpectations(argo, { shipId: mergerId, taskDoneBy: null }));
    await expect(expectationsOnMerger()).resolves.toMatchObject({ reportChangesWithin: { minutes: 60 }, taskDoneBy: null });

    unwrap(await core.useCases.setExpectations(argo, { shipId: mergerId, reportChangesWithin: null }));
    await expect(expectationsOnMerger()).resolves.toEqual({ reportChangesWithin: null, taskDoneBy: null });
    await expect(expectationsRows()).resolves.toBe(0);
  });

  it('rolls back a set that fails before commit: no expectations and no event', async () => {
    const failing = createSetExpectations({
      uow: { run: (work) => createPrismaUnitOfWork(core.prisma).run((tx) => work({ ...tx, events: { append: () => Promise.reject(new Error('the server failed before commit')) } })) },
      clock: core.clock,
      ids: createIdGenerator(),
    });

    await expect(failing(argo, { shipId: mergerId, reportChangesWithin: 60 })).rejects.toThrow('the server failed before commit');
    await expect(expectationsRows()).resolves.toBe(0);
    await expect(expectationsEvents()).resolves.toEqual([]);
  });

  it('removes them when the ship retires', async () => {
    unwrap(await core.useCases.setExpectations(argo, { shipId: mergerId, reportChangesWithin: 60, taskDoneBy: { task: PULL_REQUEST, doneBy: SIX_PM } }));

    unwrap(await core.useCases.retireShip(argo, { shipId: mergerId }));

    await expect(expectationsRows()).resolves.toBe(0);
  });
});
