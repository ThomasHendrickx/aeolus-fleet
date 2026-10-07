import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let plugin: Caller;
let pluginId: ShipId;
let builderId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-07T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['fleet:read', 'labels:define', 'labels:assign'] });
  pluginId = plugin.shipId;
  ({ shipId: builderId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'implementer' })));
  unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] }));
  unwrap(await registry.defineLabel(plugin, { key: 'project', values: ['hemma'] }));
  unwrap(await registry.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' }));
  unwrap(await registry.assignLabel(plugin, { shipId: builderId, key: 'project', value: 'hemma' }));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

function carriedBy(shipId: ShipId) {
  return core.state.shipLabels.filter((carried) => carried.shipId === shipId).map(({ key, value }) => `${key}=${value}`);
}

describe('unassigning a label', () => {
  it('lets its owner take it off a ship, which keeps its other labels', async () => {
    await expect(registry.unassignLabel(plugin, { shipId: builderId, key: 'os' })).resolves.toEqual({ isOk: true, value: undefined });

    expect(carriedBy(builderId)).toEqual(['project=hemma']);
  });

  it('writes LabelUnassigned, caused by the owner, naming the ship, with the key and the value it carried', async () => {
    unwrap(await registry.unassignLabel(plugin, { shipId: builderId, key: 'os' }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'LabelUnassigned',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: pluginId },
        shipId: builderId,
        details: { key: 'os', value: 'macos' },
      }),
    ]);
  });

  it('changes nothing and writes no event for a ship that does not carry it', async () => {
    unwrap(await registry.unassignLabel(plugin, { shipId: builderId, key: 'os' }));
    core.state.events.length = 0;

    await expect(registry.unassignLabel(plugin, { shipId: builderId, key: 'os' })).resolves.toEqual({ isOk: true, value: undefined });
    expect(core.state.events).toEqual([]);
  });

  it('refuses a ship that does not own the label, argo too', async () => {
    await expect(registry.unassignLabel(argo, { shipId: builderId, key: 'os' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'NOT_THE_LABEL_OWNER', message: 'The label os is owned by trierarch-plugin: only its owner unassigns it' },
    });
    expect(carriedBy(builderId)).toEqual(['os=macos', 'project=hemma']);
  });

  it("refuses the owner's own ship, which never carries its labels", async () => {
    await expect(registry.unassignLabel(plugin, { shipId: pluginId, key: 'os' })).resolves.toMatchObject({ isOk: false, error: { kind: 'LABEL_ON_OWN_SHIP' } });
  });

  it('refuses a key the fleet has no label for, and a ship it does not have', async () => {
    await expect(registry.unassignLabel(plugin, { shipId: builderId, key: 'team' })).resolves.toMatchObject({ isOk: false, error: { kind: 'LABEL_NOT_FOUND' } });
    await expect(registry.unassignLabel(plugin, { shipId: core.ids('ship'), key: 'os' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_FOUND' } });
  });
});
