import { createIdGenerator, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { createPrismaShipRepository, createPrismaFleetListing } from '../src/adapters/prisma/registry.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createRecordPluginRead } from '../src/domain/registry/record-plugin-read.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { unwrap } from '../src/testing/result.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';
import { operatorCaller } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

let core: PostgresCore;
let argo: ShipCaller;
let pluginShipId: ShipId;

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' })));
  argo = operatorCaller(fleet);
  ({ shipId: pluginShipId } = unwrap(await core.useCases.commissionShip(argo, {
    name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'plugin', idempotencyKey: 'plugin',
  })));
});

afterEach(async () => {
  await core?.close();
});

function failedRead(pluginShipId: ShipId) {
  return { pluginShipId, read: 'guard.get', outcome: 'failed', reason: 'timeout' } as const;
}

it('carries the recorded failure with the detail and the fleet list', async () => {
  unwrap(await core.useCases.recordPluginRead(argo, failedRead(pluginShipId)));

  const detail = unwrap(await core.useCases.getShip(argo, { shipId: pluginShipId }));
  const list = await core.useCases.listFleet(argo);
  const failure = { at: core.clock.now().toISOString(), read: 'guard.get', reason: 'timeout' };
  const pluginReads = { lastFailed: failure, failingSince: failure, lastGood: null };
  expect(detail).toMatchObject({ pluginReads });
  expect(list.ships.find((ship) => ship.id === pluginShipId)).toMatchObject({ pluginReads });
  expect(list.ships.find((ship) => ship.id === argo.shipId)).toMatchObject({ pluginReads: null });
});

it('rollback leaves no event, fact or counter increment', async () => {
  const counted: unknown[] = [];
  const uow = createPrismaUnitOfWork(core.prisma);
  const record = createRecordPluginRead({
    uow: { run: (work) => uow.run(async (tx) => {
      await work(tx);
      throw new Error('record failed before commit');
    }) },
    clock: core.clock,
    ids: createIdGenerator(),
    countFailure: (failure) => counted.push(failure),
  });

  await expect(record(argo, failedRead(pluginShipId))).rejects.toThrow('record failed before commit');

  const detail = unwrap(await core.useCases.getShip(argo, { shipId: pluginShipId }));
  expect(detail).toMatchObject({ pluginReads: { lastFailed: null, failingSince: null, lastGood: null } });
  await expect(core.prisma.event.count({ where: { fleetId: argo.fleetId, type: 'PluginReadFailed' } })).resolves.toBe(0);
  expect(counted).toEqual([]);
});

it('locks and reads the plugin fact through the fleet and ship key', async () => {
  const ships = createPrismaShipRepository(core.prisma);
  const listing = createPrismaFleetListing(core.prisma);

  await expect(ships.findForUpdate(argo.fleetId, pluginShipId)).resolves.toMatchObject({ id: pluginShipId });
  await expect(listing.ship(argo.fleetId, pluginShipId)).resolves.toBeDefined();
  await assertIndexedPlan(core.prisma, Prisma.sql`
    SELECT plugin_reads FROM ships WHERE fleet_id = ${argo.fleetId} AND id = ${pluginShipId} FOR NO KEY UPDATE
  `);
});
