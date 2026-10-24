import { idSchema, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import type { ShipCaller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;
let plugin: ShipCaller;
let pluginId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-07T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['fleet:read', 'labels:define', 'labels:assign'] });
  pluginId = plugin.shipId;
});

describe("listing the fleet's labels", () => {
  it('lists every label by key, with its id, its values with theirs, and its owner by id and name', async () => {
    const project = unwrap(await registry.defineLabel(plugin, { key: 'project', values: ['hemma', 'aeolus'] }));
    const os = unwrap(await registry.defineLabel(argo, { key: 'os', values: ['macos', 'linux'] }));

    await expect(registry.listLabels(argo)).resolves.toEqual([
      { id: os.labelId, key: 'os', values: os.values.map((value) => ({ ...value, shipCount: 0 })), owner: { kind: 'ship', id: argo.shipId, name: 'argo' } },
      { id: project.labelId, key: 'project', values: project.values.map((value) => ({ ...value, shipCount: 0 })), owner: { kind: 'ship', id: pluginId, name: 'trierarch-plugin' } },
    ]);
  });

  it("lists none for a fleet without labels, and never another fleet's", async () => {
    const other = await hostedFleet(core);
    unwrap(await registry.defineLabel({ ...argo, fleetId: other.fleetId, shipId: other.operatorShipId }, { key: 'os', values: ['macos'] }));

    await expect(registry.listLabels(argo)).resolves.toEqual([]);
  });
});

describe('how many ships carry each label value', () => {
  async function shipCountsOf(caller: ShipCaller): Promise<Record<string, number>> {
    return Object.fromEntries((await registry.listLabels(caller)).flatMap((label) => label.values.map((value) => [`${label.key}=${value.value}`, value.shipCount])));
  }

  it('counts the active ships that carry it', async () => {
    const os = unwrap(await registry.defineLabel(argo, { key: 'os', values: ['macos', 'linux'] }));
    for (const name of ['scout', 'builder']) {
      const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }));
      unwrap(await registry.assignLabel(argo, { shipId, valueId: idSchema('labelValue').parse(os.values[0]?.id) }));
    }

    await expect(shipCountsOf(argo)).resolves.toEqual({ 'os=macos': 2, 'os=linux': 0 });
  });

  it('leaves a retired ship out of the count', async () => {
    const os = unwrap(await registry.defineLabel(argo, { key: 'os', values: ['macos'] }));
    const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'old', type: 'reviewer' }));
    unwrap(await registry.assignLabel(argo, { shipId, valueId: idSchema('labelValue').parse(os.values[0]?.id) }));
    unwrap(await registry.retireShip(argo, { shipId }));

    await expect(shipCountsOf(argo)).resolves.toEqual({ 'os=macos': 0 });
  });

  it('counts only the ships in the caller\'s read reach (decision 0034)', async () => {
    const fleet = await readReachScenario();
    const os = unwrap(await fleet.registry.defineLabel(fleet.argo, { key: 'os', values: ['macos'] }));
    for (const shipId of [fleet.near.shipId, fleet.far.shipId]) {
      unwrap(await fleet.registry.assignLabel(fleet.argo, { shipId, valueId: idSchema('labelValue').parse(os.values[0]?.id) }));
    }
    await fleet.readRulesApply();

    const counted = async (caller: ShipCaller) => (await fleet.registry.listLabels(caller)).find((label) => label.key === 'os')?.values[0]?.shipCount;

    expect([await counted(fleet.argo), await counted(fleet.reader)]).toEqual([2, 1]);
  });
});
