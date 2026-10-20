import type { LabelValueId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { carriedText, valueIdOf } from '../../../test/support/label-fixtures.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;
let plugin: ShipCaller;
let pluginId: ShipId;
let builderId: ShipId;
let macos: LabelValueId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-07T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['fleet:read', 'fleet:commission', 'labels:define', 'labels:assign'] });
  pluginId = plugin.shipId;
  ({ shipId: builderId } = unwrap(await registry.commissionShip(plugin, { idempotencyKey: newKey(), name: 'builder', type: 'implementer' })));
  unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] }));
  unwrap(await registry.defineLabel(plugin, { key: 'project', values: ['hemma'] }));
  macos = valueIdOf(core, { key: 'os', value: 'macos' });
  unwrap(await registry.assignLabel(plugin, { shipId: builderId, valueId: macos }));
  unwrap(await registry.assignLabel(plugin, { shipId: builderId, valueId: valueIdOf(core, { key: 'os', value: 'linux' }) }));
  unwrap(await registry.assignLabel(plugin, { shipId: builderId, valueId: valueIdOf(core, { key: 'project', value: 'hemma' }) }));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

describe('unassigning a label', () => {
  it('lets its owner take one value off a ship, which keeps its other values', async () => {
    await expect(registry.unassignLabel(plugin, { shipId: builderId, valueId: macos })).resolves.toEqual({ isOk: true, value: undefined });

    expect(carriedText(core, builderId)).toEqual(['os=linux', 'project=hemma']);
  });

  it('writes LabelUnassigned, caused by the owner, naming the ship, with the label and the value it carried, ids and text', async () => {
    unwrap(await registry.unassignLabel(plugin, { shipId: builderId, valueId: macos }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'LabelUnassigned',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: pluginId },
        shipId: builderId,
        details: { labelId: core.state.labels[0]?.id, key: 'os', valueId: macos, value: 'macos' },
      }),
    ]);
  });

  it('changes nothing and writes no event for a ship that does not carry the value', async () => {
    unwrap(await registry.unassignLabel(plugin, { shipId: builderId, valueId: macos }));
    core.state.events.length = 0;

    await expect(registry.unassignLabel(plugin, { shipId: builderId, valueId: macos })).resolves.toEqual({ isOk: true, value: undefined });
    expect(core.state.events).toEqual([]);
  });

  it('refuses a ship that does not own the label and holds no labels:any', async () => {
    const unassigner: ShipCaller = { ...argo, shipId: builderId, kind: 'agent', scopes: ['labels:assign'] };

    await expect(registry.unassignLabel(unassigner, { shipId: builderId, valueId: macos })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'NOT_THE_LABEL_OWNER', message: 'The label os is owned by trierarch-plugin: only its owner unassigns it' },
    });
    expect(carriedText(core, builderId)).toEqual(['os=linux', 'os=macos', 'project=hemma']);
  });

  it('refuses a ship it neither is nor commissioned, which keeps the value it carries from before (decision 0046)', async () => {
    const { shipId: strangerId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'stranger', type: 'implementer' }));
    const labelId = core.state.labels.find((label) => label.key === 'os')?.id ?? core.ids('label');
    core.state.shipLabels.push({ fleetId: argo.fleetId, shipId: strangerId, labelId, valueId: macos });

    await expect(registry.unassignLabel(plugin, { shipId: strangerId, valueId: macos })).resolves.toEqual({
      isOk: false,
      error: { kind: 'NOT_YOUR_SHIP_TO_LABEL', message: 'stranger is neither your ship nor one it commissioned: labelling it needs labels:any' },
    });
    expect(carriedText(core, strangerId)).toEqual(['os=macos']);
  });

  it("lets argo, which holds labels:any, take another owner's value off a ship (decision 0053)", async () => {
    unwrap(await registry.unassignLabel(argo, { shipId: builderId, valueId: macos }));

    expect(carriedText(core, builderId)).toEqual(['os=linux', 'project=hemma']);
  });

  it('lets argo take a value of a label argo owns off any ship (decision 0046)', async () => {
    unwrap(await registry.defineLabel(argo, { key: 'tier', values: ['gold'] }));
    const gold = valueIdOf(core, { key: 'tier', value: 'gold' });
    unwrap(await registry.assignLabel(argo, { shipId: pluginId, valueId: gold }));

    unwrap(await registry.unassignLabel(argo, { shipId: pluginId, valueId: gold }));

    expect(carriedText(core, pluginId)).toEqual([]);
  });

  it("takes its value off the owner's own ship too (#573)", async () => {
    unwrap(await registry.assignLabel(plugin, { shipId: pluginId, valueId: macos }));

    unwrap(await registry.unassignLabel(plugin, { shipId: pluginId, valueId: macos }));

    expect(carriedText(core, pluginId)).toEqual([]);
  });

  it('refuses a value the fleet has no label for, and a ship it does not have', async () => {
    await expect(registry.unassignLabel(plugin, { shipId: builderId, valueId: core.ids('labelValue') })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'LABEL_VALUE_NOT_FOUND' },
    });
    await expect(registry.unassignLabel(plugin, { shipId: core.ids('ship'), valueId: macos })).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_FOUND' } });
  });
});
