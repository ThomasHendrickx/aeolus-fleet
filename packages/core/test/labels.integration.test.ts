import { createIdGenerator, type LabelId, type LabelValueId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createAssignLabel } from '../src/domain/registry/assign-label.js';
import { createChangeLabelValues } from '../src/domain/registry/change-label-values.js';
import { createRetireShip } from '../src/domain/registry/retire-ship.js';
import type { Caller } from '../src/domain/shared/caller.js';
import { OPERATOR, operatorCaller } from './support/core-fixtures.js';
import { newKey } from './support/keys.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { refusalOf, unwrap } from './support/result.js';

// Labels on a real Postgres (decision 0031): a key once per fleet, even when
// two ships define it at once; a label and each value with its own id, the
// ids kept when the values change; a ship holding a set of value ids; a
// change of values and a retire of the owner each take turns with an
// assignment, so no ship ever carries a value its label lost or a label that
// retired.

const newId = createIdGenerator();

let core: PostgresCore;
let argo: Caller;
let plugin: Caller;
let builderId: ShipId;
let osId: LabelId;
let macos: LabelValueId;
let linux: LabelValueId;

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
  const defined = unwrap(await core.useCases.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] }));
  osId = defined.labelId;
  macos = defined.values[0]?.id ?? newId('labelValue');
  linux = defined.values[1]?.id ?? newId('labelValue');
});

afterEach(async () => {
  await core.close();
});

async function labels() {
  return (await core.useCases.listLabels(argo)).map((label) => ({ key: label.key, values: label.values.map((value) => value.value), owner: label.owner.id }));
}

async function carried() {
  return (await core.useCases.listFleet(argo)).flatMap((ship) => ship.labels.map((label) => `${ship.name}:${label.key}=${label.value}`));
}

function labelEvents() {
  return core.prisma.event.findMany({ where: { type: { startsWith: 'Label' } }, orderBy: { seq: 'asc' }, select: { type: true, shipId: true, details: true } });
}

describe('labels on Postgres', () => {
  it('keep a label and its values with their ids, the ids kept when the values change, and a set of values on each ship, with their events', async () => {
    const changed = unwrap(await core.useCases.changeLabelValues(plugin, { labelId: osId, values: ['macos', 'linux', 'windows'] }));
    const windows = changed.values[2]?.id ?? newId('labelValue');
    unwrap(await core.useCases.assignLabel(plugin, { shipId: builderId, valueId: macos }));
    unwrap(await core.useCases.assignLabel(plugin, { shipId: builderId, valueId: windows }));

    expect(changed.values.map((value) => value.id).slice(0, 2)).toEqual([macos, linux]);
    await expect(core.useCases.listLabels(argo)).resolves.toEqual([
      { id: osId, key: 'os', values: [{ id: macos, value: 'macos' }, { id: linux, value: 'linux' }, { id: windows, value: 'windows' }], owner: { id: plugin.shipId, name: 'trierarch-plugin' } },
    ]);
    await expect(carried()).resolves.toEqual(['builder:os=macos', 'builder:os=windows']);
    expect((await labelEvents()).map((event) => [event.type, event.shipId])).toEqual([
      ['LabelDefined', plugin.shipId],
      ['LabelValuesChanged', plugin.shipId],
      ['LabelAssigned', builderId],
      ['LabelAssigned', builderId],
    ]);
    expect((await labelEvents())[2]?.details).toEqual({ labelId: osId, key: 'os', valueId: macos, value: 'macos' });
  });

  it('take a value off a ship, and refuse to remove a value a ship carries', async () => {
    unwrap(await core.useCases.assignLabel(plugin, { shipId: builderId, valueId: linux }));

    await expect(core.useCases.changeLabelValues(plugin, { labelId: osId, values: ['macos'] })).resolves.toMatchObject({ isOk: false, error: { kind: 'LABEL_VALUE_CARRIED' } });
    unwrap(await core.useCases.unassignLabel(plugin, { shipId: builderId, valueId: linux }));
    unwrap(await core.useCases.changeLabelValues(plugin, { labelId: osId, values: ['macos'] }));

    await expect(carried()).resolves.toEqual([]);
    await expect(labels()).resolves.toEqual([{ key: 'os', values: ['macos'], owner: plugin.shipId }]);
  });

  it('are read with the fleet: each ship with what it carries, and selected by value ids, combined with AND', async () => {
    const { shipId: testerId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'tester', type: 'implementer' }));
    const hemma = unwrap(await core.useCases.defineLabel(plugin, { key: 'project', values: ['hemma'] })).values[0]?.id ?? newId('labelValue');
    unwrap(await core.useCases.assignLabel(plugin, { shipId: builderId, valueId: macos }));
    unwrap(await core.useCases.assignLabel(plugin, { shipId: builderId, valueId: hemma }));
    unwrap(await core.useCases.assignLabel(plugin, { shipId: testerId, valueId: macos }));

    await expect(carried()).resolves.toEqual(['builder:os=macos', 'builder:project=hemma', 'tester:os=macos']);
    expect((await core.useCases.listFleet(argo, { valueIds: [macos, hemma] })).map((ship) => ship.name)).toEqual(['builder']);
    await expect(core.useCases.getShip(argo, { shipId: testerId })).resolves.toMatchObject({ value: { labels: [{ labelId: osId, key: 'os', valueId: macos, value: 'macos' }] } });
  });

  it('go with a retired ship, and retire with their owner, every assignment first, freeing the key', async () => {
    const { shipId: testerId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'tester', type: 'implementer' }));
    const core1 = unwrap(await core.useCases.defineLabel(argo, { key: 'team', values: ['core'] })).values[0]?.id ?? newId('labelValue');
    unwrap(await core.useCases.assignLabel(plugin, { shipId: builderId, valueId: macos }));
    unwrap(await core.useCases.assignLabel(plugin, { shipId: testerId, valueId: linux }));
    unwrap(await core.useCases.assignLabel(argo, { shipId: builderId, valueId: core1 }));

    unwrap(await core.useCases.retireShip(argo, { shipId: builderId }));
    await expect(carried()).resolves.toEqual(['tester:os=linux']);

    unwrap(await core.useCases.retireShip(argo, { shipId: plugin.shipId }));
    await expect(carried()).resolves.toEqual([]);
    await expect(labels()).resolves.toEqual([{ key: 'team', values: ['core'], owner: argo.shipId }]);
    await expect(core.useCases.defineLabel(argo, { key: 'os', values: ['windows'] })).resolves.toMatchObject({ isOk: true });
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
        carriersOf: async (fleetId, labelId) => {
          await hold();
          return tx.labels.carriersOf(fleetId, labelId);
        },
      },
    }));
    const change = createChangeLabelValues({ uow, clock: core.clock, ids: newId })(plugin, { labelId: osId, values: ['macos'] });
    await reached;

    const assign = core.useCases.assignLabel(plugin, { shipId: builderId, valueId: linux });

    await expect(change).resolves.toMatchObject({ isOk: true });
    await expect(assign).resolves.toMatchObject({ isOk: false, error: { kind: 'LABEL_VALUE_NOT_FOUND' } });
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
    const assign = createAssignLabel({ uow, clock: core.clock, ids: newId })(plugin, { shipId: builderId, valueId: linux });
    await reached;

    const change = core.useCases.changeLabelValues(plugin, { labelId: osId, values: ['macos'] });

    await expect(assign).resolves.toEqual({ isOk: true, value: undefined });
    await expect(change).resolves.toMatchObject({ isOk: false, error: { kind: 'LABEL_VALUE_CARRIED' } });
    await expect(carried()).resolves.toEqual(['builder:os=linux']);
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
    const assign = createAssignLabel({ uow, clock: core.clock, ids: newId })(plugin, { shipId: builderId, valueId: macos });
    await reached;

    const retire = createRetireShip({ uow: createPrismaUnitOfWork(core.prisma), clock: core.clock, ids: newId })(argo, { shipId: plugin.shipId });

    await expect(assign).resolves.toEqual({ isOk: true, value: undefined });
    await expect(retire).resolves.toMatchObject({ isOk: true });
    await expect(carried()).resolves.toEqual([]);
    await expect(labels()).resolves.toEqual([]);
  });
});

describe('two assignments to one ship at its label limit', () => {
  it('take turns: the twenty-first value is refused', async () => {
    const many = unwrap(await core.useCases.defineLabel(plugin, { key: 'many', values: Array.from({ length: 19 }, (_, index) => `v${String(index)}`) }));
    for (const value of many.values) {
      unwrap(await core.useCases.assignLabel(plugin, { shipId: builderId, valueId: value.id }));
    }

    const assigned = await Promise.all([
      core.useCases.assignLabel(plugin, { shipId: builderId, valueId: macos }),
      core.useCases.assignLabel(plugin, { shipId: builderId, valueId: linux }),
    ]);

    expect(assigned.filter((result) => !result.isOk).map((result) => refusalOf(result).kind)).toEqual(['SHIP_LABEL_LIMIT_REACHED']);
    await expect(core.prisma.shipLabel.count({ where: { shipId: builderId } })).resolves.toBe(20);
  });
});
