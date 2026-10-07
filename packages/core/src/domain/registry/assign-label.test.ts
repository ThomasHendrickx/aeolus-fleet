import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addViewerShip, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let argoId: ShipId;
let plugin: Caller;
let pluginId: ShipId;
let builderId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-07T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['fleet:read', 'labels:define', 'labels:assign'] });
  pluginId = plugin.shipId;
  ({ shipId: builderId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'implementer' })));
  unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] }));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

function carriedBy(shipId: ShipId) {
  return core.state.shipLabels.filter((carried) => carried.shipId === shipId);
}

describe('assigning a label', () => {
  it('lets its owner give a ship one of its values', async () => {
    await expect(registry.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' })).resolves.toEqual({ isOk: true, value: undefined });

    expect(carriedBy(builderId)).toEqual([{ fleetId, shipId: builderId, key: 'os', value: 'macos' }]);
  });

  it('writes LabelAssigned, caused by the owner, naming the ship, with the key and the value', async () => {
    unwrap(await registry.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'LabelAssigned',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: pluginId },
        shipId: builderId,
        details: { key: 'os', value: 'macos' },
      }),
    ]);
  });

  it('replaces the value a ship carries: one value per key', async () => {
    unwrap(await registry.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' }));

    unwrap(await registry.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'linux' }));

    expect(carriedBy(builderId)).toEqual([{ fleetId, shipId: builderId, key: 'os', value: 'linux' }]);
    expect(core.state.events.map((event) => event.details)).toEqual([
      { key: 'os', value: 'macos' },
      { key: 'os', value: 'linux' },
    ]);
  });

  it('changes nothing and writes no event for the value the ship carries', async () => {
    unwrap(await registry.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' }));
    core.state.events.length = 0;

    unwrap(await registry.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' }));

    expect(core.state.events).toEqual([]);
  });

  it("refuses the owner's own ship: no ship labels itself", async () => {
    const refused = refusalOf(await registry.assignLabel(plugin, { shipId: pluginId, key: 'os', value: 'macos' }));

    expect(refused.kind).toBe('LABEL_ON_OWN_SHIP');
    expect(carriedBy(pluginId)).toEqual([]);
  });

  it('refuses a ship that does not own the label, argo too', async () => {
    await expect(registry.assignLabel(argo, { shipId: builderId, key: 'os', value: 'macos' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'NOT_THE_LABEL_OWNER' },
    });
    expect(carriedBy(builderId)).toEqual([]);
  });

  it('refuses a key the fleet has no label for', async () => {
    await expect(registry.assignLabel(plugin, { shipId: builderId, key: 'project', value: 'hemma' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'LABEL_NOT_FOUND' },
    });
  });

  it('refuses a value the label does not define, naming the ones it does', async () => {
    const refused = refusalOf(await registry.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'windows' }));

    expect(refused).toEqual({ kind: 'LABEL_VALUE_NOT_DEFINED', message: 'The label os has no value windows: its values are macos, linux' });
  });

  it('refuses a ship the fleet does not have', async () => {
    await expect(registry.assignLabel(plugin, { shipId: core.ids('ship'), key: 'os', value: 'macos' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });

  it('refuses a retired ship', async () => {
    unwrap(await registry.retireShip(argo, { shipId: builderId }));

    await expect(registry.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_ALREADY_RETIRED' },
    });
    expect(carriedBy(builderId)).toEqual([]);
  });

  it('takes argo and the viewer ship: Aeolus adds no policy', async () => {
    const { shipId: viewerId } = addViewerShip(core, { fleetId });

    unwrap(await registry.assignLabel(plugin, { shipId: argoId, key: 'os', value: 'macos' }));
    unwrap(await registry.assignLabel(plugin, { shipId: viewerId, key: 'os', value: 'linux' }));

    expect([...carriedBy(argoId), ...carriedBy(viewerId)].map((carried) => carried.value)).toEqual(['macos', 'linux']);
  });

  describe('at the most labels a ship carries', () => {
    beforeEach(async () => {
      for (let index = 1; index < 20; index += 1) {
        unwrap(await registry.defineLabel(plugin, { key: `k${String(index)}`, values: ['v'] }));
        unwrap(await registry.assignLabel(plugin, { shipId: builderId, key: `k${String(index)}`, value: 'v' }));
      }
      unwrap(await registry.defineLabel(plugin, { key: 'project', values: ['hemma'] }));
    });

    it('takes a twentieth label', async () => {
      unwrap(await registry.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' }));

      expect(carriedBy(builderId)).toHaveLength(20);
    });

    it('refuses a twenty-first, naming the limits decision', async () => {
      unwrap(await registry.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' }));

      const refused = refusalOf(await registry.assignLabel(plugin, { shipId: builderId, key: 'project', value: 'hemma' }));

      expect(refused.kind).toBe('SHIP_LABEL_LIMIT_REACHED');
      expect(refused.message).toContain('decision 0031');
      expect(carriedBy(builderId)).toHaveLength(20);
    });

    it('still replaces the value of a label the ship carries', async () => {
      unwrap(await registry.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'macos' }));

      await expect(registry.assignLabel(plugin, { shipId: builderId, key: 'os', value: 'linux' })).resolves.toMatchObject({ isOk: true });
    });
  });
});
