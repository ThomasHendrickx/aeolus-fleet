import { createIdGenerator, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAssignLabel } from '../src/domain/registry/assign-label.js';
import { createChangeLabelValues } from '../src/domain/registry/change-label-values.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createRetireShip } from '../src/domain/registry/retire-ship.js';
import type { Caller } from '../src/domain/shared/caller.js';
import { OPERATOR, operatorCaller } from './support/core-fixtures.js';
import { newKey } from './support/keys.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { refusalOf, unwrap } from './support/result.js';

// Labels on a real Postgres (decision 0031): a key once per fleet, even when
// two ships define it at once; assignments one value per key; a change of
// values and a retire of the owner each take turns with an assignment, so no
// ship ever carries a value its label lost or a label that retired.

const newId = createIdGenerator();

let core: PostgresCore;
let argo: Caller;
let plugin: Caller;
let builderId: ShipId;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const { shipId: pluginId } = unwrap(
    await core.useCases.commissionShip(argo, {
      idempotencyKey: newKey(),
      name: 'trierarch-plugin',
      type: 'trierarch-plugin',
      fleetScopes: ['fleet:read', 'labels:define', 'labels:assign'],
    }),
  );
  plugin = { fleetId: argo.fleetId, shipId: pluginId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:read', 'labels:define', 'labels:assign'] };
  ({ shipId: builderId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'implementer' })));
  unwrap(await core.useCases.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] }));
});

afterEach(async () => {
  await core.close();
});

function labels() {
  return core.prisma.label.findMany({ orderBy: { key: 'asc' }, select: { key: true, values: true, ownerShipId: true } });
}

function carried() {
  return core.prisma.shipLabel.findMany({ orderBy: [{ shipId: 'asc' }, { key: 'asc' }], select: { shipId: true, key: true, value: true } });
}

function eventTypes() {
  return core.prisma.event.findMany({ where: { type: { startsWith: 'Label' } }, orderBy: { seq: 'asc' }, select: { type: true, shipId: true, details: true } });
}

describe('labels on Postgres', () => {
  it('keep a label with its values, owned by its ship, and what each ship carries, one value per key, with their events', async () => {
    unwrap(await core.useCases.changeLabelValues(plugin, { key: 'os', values: ['macos', 'linux', 'windows'] }));
    unwrap(await core.useCases.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' }));
    unwrap(await core.useCases.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'windows' }));

    await expect(labels()).resolves.toEqual([{ key: 'os', values: ['macos', 'linux', 'windows'], ownerShipId: plugin.shipId }]);
    await expect(carried()).resolves.toEqual([{ shipId: builderId, key: 'os', value: 'windows' }]);
    await expect(eventTypes()).resolves.toEqual([
      { type: 'LabelDefined', shipId: plugin.shipId, details: { key: 'os', values: 'macos,linux' } },
      { type: 'LabelValuesChanged', shipId: plugin.shipId, details: { key: 'os', values: 'macos,linux,windows' } },
      { type: 'LabelAssigned', shipId: builderId, details: { key: 'os', value: 'macos' } },
      { type: 'LabelAssigned', shipId: builderId, details: { key: 'os', value: 'windows' } },
    ]);
  });

  it('take a ship off a label, and refuse to remove a value a ship carries', async () => {
    unwrap(await core.useCases.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'linux' }));

    await expect(core.useCases.changeLabelValues(plugin, { key: 'os', values: ['macos'] })).resolves.toMatchObject({ isOk: false, error: { kind: 'LABEL_VALUE_CARRIED' } });
    unwrap(await core.useCases.unassignLabel(plugin, { shipId: builderId, key: 'os' }));
    unwrap(await core.useCases.changeLabelValues(plugin, { key: 'os', values: ['macos'] }));

    await expect(carried()).resolves.toEqual([]);
    await expect(labels()).resolves.toEqual([{ key: 'os', values: ['macos'], ownerShipId: plugin.shipId }]);
  });

  it('go with a retired ship, and retire with their owner, every assignment first, freeing the key', async () => {
    const { shipId: testerId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'tester', type: 'implementer' }));
    unwrap(await core.useCases.defineLabel(argo, { key: 'team', values: ['core'] }));
    unwrap(await core.useCases.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' }));
    unwrap(await core.useCases.assignLabel(plugin, { shipId: testerId, key: 'os', value: 'linux' }));
    unwrap(await core.useCases.assignLabel(argo, { shipId: builderId, key: 'team', value: 'core' }));

    unwrap(await core.useCases.retireShip(argo, { shipId: builderId }));
    await expect(carried()).resolves.toEqual([{ shipId: testerId, key: 'os', value: 'linux' }]);

    unwrap(await core.useCases.retireShip(argo, { shipId: plugin.shipId }));
    await expect(carried()).resolves.toEqual([]);
    await expect(labels()).resolves.toEqual([{ key: 'team', values: ['core'], ownerShipId: argo.shipId }]);
    await expect(core.useCases.defineLabel(argo, { key: 'os', values: ['windows'] })).resolves.toEqual({ isOk: true, value: undefined });
  });

  it('are read with the fleet: the labels by key with their owners, each ship with what it carries, and selected by them', async () => {
    const { shipId: testerId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'tester', type: 'implementer' }));
    unwrap(await core.useCases.defineLabel(plugin, { key: 'project', values: ['hemma'] }));
    unwrap(await core.useCases.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' }));
    unwrap(await core.useCases.assignLabel(plugin, { shipId: builderId, key: 'project', value: 'hemma' }));
    unwrap(await core.useCases.assignLabel(plugin, { shipId: testerId, key: 'os', value: 'macos' }));

    await expect(core.useCases.listLabels(argo)).resolves.toEqual([
      { key: 'os', values: ['macos', 'linux'], owner: { id: plugin.shipId, name: 'trierarch-plugin' } },
      { key: 'project', values: ['hemma'], owner: { id: plugin.shipId, name: 'trierarch-plugin' } },
    ]);
    expect((await core.useCases.listFleet(argo)).map((ship) => [ship.name, ship.labels])).toEqual([
      ['argo', {}],
      ['trierarch-plugin', {}],
      ['builder', { os: 'macos', project: 'hemma' }],
      ['tester', { os: 'macos' }],
    ]);
    expect((await core.useCases.listFleet(argo, { labels: { os: 'macos', project: 'hemma' } })).map((ship) => ship.name)).toEqual(['builder']);
    await expect(core.useCases.getShip(argo, { shipId: testerId })).resolves.toMatchObject({ value: { labels: { os: 'macos' } } });
  });

  it('keep a key once in the fleet when two ships define it at once: one is refused, naming the owner', async () => {
    const defined = await Promise.all([
      core.useCases.defineLabel(plugin, { key: 'project', values: ['hemma'] }),
      core.useCases.defineLabel(argo, { key: 'project', values: ['aeolus'] }),
    ]);

    expect(defined.filter((result) => result.isOk)).toHaveLength(1);
    expect(defined.filter((result) => !result.isOk).map((result) => refusalOf(result).kind)).toEqual(['LABEL_KEY_TAKEN']);
    await expect(core.prisma.label.count({ where: { key: 'project' } })).resolves.toBe(1);
  });
});

describe('an assignment racing a change of values', () => {
  it('waits for a change that locked the label first, then is refused: the value is gone', async () => {
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      labels: {
        ...tx.labels,
        carriersOf: async (fleetId, key) => {
          await hold();
          return tx.labels.carriersOf(fleetId, key);
        },
      },
    }));
    const change = createChangeLabelValues({ uow, clock: core.clock, ids: newId })(plugin, { key: 'os', values: ['macos'] });
    await reached;

    const assign = core.useCases.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'linux' });

    await expect(change).resolves.toEqual({ isOk: true, value: undefined });
    await expect(assign).resolves.toMatchObject({ isOk: false, error: { kind: 'LABEL_VALUE_NOT_DEFINED' } });
    await expect(carried()).resolves.toEqual([]);
  });

  it('makes a change wait for an assignment that holds the label, then refuses the change: a ship carries the value', async () => {
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      labels: {
        ...tx.labels,
        assign: async (assignment) => {
          await hold();
          await tx.labels.assign(assignment);
        },
      },
    }));
    const assign = createAssignLabel({ uow, clock: core.clock, ids: newId })(plugin, { shipId: builderId, key: 'os', value: 'linux' });
    await reached;

    const change = core.useCases.changeLabelValues(plugin, { key: 'os', values: ['macos'] });

    await expect(assign).resolves.toEqual({ isOk: true, value: undefined });
    await expect(change).resolves.toMatchObject({ isOk: false, error: { kind: 'LABEL_VALUE_CARRIED' } });
    await expect(carried()).resolves.toEqual([{ shipId: builderId, key: 'os', value: 'linux' }]);
  });
});

describe("an assignment racing its owner's retire", () => {
  it('makes the retire wait, then the retire takes the new assignment with the label', async () => {
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      labels: {
        ...tx.labels,
        assign: async (assignment) => {
          await hold();
          await tx.labels.assign(assignment);
        },
      },
    }));
    const assign = createAssignLabel({ uow, clock: core.clock, ids: newId })(plugin, { shipId: builderId, key: 'os', value: 'macos' });
    await reached;

    const retire = createRetireShip({ uow: createPrismaUnitOfWork(core.prisma), clock: core.clock, ids: newId })(argo, { shipId: plugin.shipId });

    await expect(assign).resolves.toEqual({ isOk: true, value: undefined });
    await expect(retire).resolves.toMatchObject({ isOk: true });
    await expect(carried()).resolves.toEqual([]);
    await expect(labels()).resolves.toEqual([]);
  });
});

describe('two assignments to one ship at its label limit', () => {
  it('take turns: the twenty-first is refused', async () => {
    for (let index = 1; index < 20; index += 1) {
      unwrap(await core.useCases.defineLabel(plugin, { key: `k${String(index)}`, values: ['v'] }));
      unwrap(await core.useCases.assignLabel(plugin, { shipId: builderId, key: `k${String(index)}`, value: 'v' }));
    }
    unwrap(await core.useCases.defineLabel(plugin, { key: 'project', values: ['hemma'] }));

    const assigned = await Promise.all([
      core.useCases.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' }),
      core.useCases.assignLabel(plugin, { shipId: builderId, key: 'project', value: 'hemma' }),
    ]);

    expect(assigned.filter((result) => !result.isOk).map((result) => refusalOf(result).kind)).toEqual(['SHIP_LABEL_LIMIT_REACHED']);
    await expect(core.prisma.shipLabel.count({ where: { shipId: builderId } })).resolves.toBe(20);
  });
});
