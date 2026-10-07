import type { FleetId, LabelId, LabelValueId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { addViewerShip, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { carriedText, valueIdOf } from '../../../test/support/label-fixtures.js';
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
let osId: LabelId;
let macos: LabelValueId;
let linux: LabelValueId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-07T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['fleet:read', 'labels:define', 'labels:assign'] });
  pluginId = plugin.shipId;
  ({ shipId: builderId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'builder', type: 'implementer' })));
  ({ labelId: osId } = unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] })));
  macos = valueIdOf(core, { key: 'os', value: 'macos' });
  linux = valueIdOf(core, { key: 'os', value: 'linux' });
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

describe('assigning a label', () => {
  it('lets its owner give a ship one of its values, by its id', async () => {
    await expect(registry.assignLabel(plugin, { shipId: builderId, valueId: macos })).resolves.toEqual({ isOk: true, value: undefined });

    expect(core.state.shipLabels).toEqual([{ fleetId, shipId: builderId, labelId: osId, valueId: macos }]);
  });

  it('writes LabelAssigned, caused by the owner, naming the ship, with the label and the value, ids and text', async () => {
    unwrap(await registry.assignLabel(plugin, { shipId: builderId, valueId: macos }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'LabelAssigned',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: pluginId },
        shipId: builderId,
        details: { labelId: osId, key: 'os', valueId: macos, value: 'macos' },
      }),
    ]);
  });

  it('adds a second value of a label the ship carries: a ship holds a set of values', async () => {
    unwrap(await registry.assignLabel(plugin, { shipId: builderId, valueId: macos }));

    unwrap(await registry.assignLabel(plugin, { shipId: builderId, valueId: linux }));

    expect(carriedText(core, builderId)).toEqual(['os=linux', 'os=macos']);
  });

  it('changes nothing and writes no event for a value the ship carries', async () => {
    unwrap(await registry.assignLabel(plugin, { shipId: builderId, valueId: macos }));
    core.state.events.length = 0;

    unwrap(await registry.assignLabel(plugin, { shipId: builderId, valueId: macos }));

    expect(core.state.shipLabels).toHaveLength(1);
    expect(core.state.events).toEqual([]);
  });

  it("refuses the owner's own ship: no ship labels itself", async () => {
    const refused = refusalOf(await registry.assignLabel(plugin, { shipId: pluginId, valueId: macos }));

    expect(refused.kind).toBe('LABEL_ON_OWN_SHIP');
    expect(core.state.shipLabels).toEqual([]);
  });

  it('refuses a ship that does not own the label, argo too', async () => {
    await expect(registry.assignLabel(argo, { shipId: builderId, valueId: macos })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'NOT_THE_LABEL_OWNER', message: 'The label os is owned by trierarch-plugin: only its owner assigns it' },
    });
    expect(core.state.shipLabels).toEqual([]);
  });

  it('refuses a value the fleet has no label for', async () => {
    await expect(registry.assignLabel(plugin, { shipId: builderId, valueId: core.ids('labelValue') })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'LABEL_VALUE_NOT_FOUND' },
    });
  });

  it('refuses a ship the fleet does not have', async () => {
    await expect(registry.assignLabel(plugin, { shipId: core.ids('ship'), valueId: macos })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });

  it('refuses a retired ship', async () => {
    unwrap(await registry.retireShip(argo, { shipId: builderId }));

    await expect(registry.assignLabel(plugin, { shipId: builderId, valueId: macos })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_ALREADY_RETIRED' },
    });
    expect(core.state.shipLabels).toEqual([]);
  });

  it('takes argo and the viewer ship: Aeolus adds no policy', async () => {
    const { shipId: viewerId } = addViewerShip(core, { fleetId });

    unwrap(await registry.assignLabel(plugin, { shipId: argoId, valueId: macos }));
    unwrap(await registry.assignLabel(plugin, { shipId: viewerId, valueId: linux }));

    expect([...carriedText(core, argoId), ...carriedText(core, viewerId)]).toEqual(['os=macos', 'os=linux']);
  });

  describe('at the most labels a ship carries', () => {
    let hemma: LabelValueId;

    beforeEach(async () => {
      const values = Array.from({ length: 19 }, (_, index) => `v${String(index)}`);
      unwrap(await registry.defineLabel(plugin, { key: 'many', values }));
      for (const value of values) {
        unwrap(await registry.assignLabel(plugin, { shipId: builderId, valueId: valueIdOf(core, { key: 'many', value: value }) }));
      }
      unwrap(await registry.defineLabel(plugin, { key: 'project', values: ['hemma'] }));
      hemma = valueIdOf(core, { key: 'project', value: 'hemma' });
    });

    it('takes a twentieth value', async () => {
      unwrap(await registry.assignLabel(plugin, { shipId: builderId, valueId: macos }));

      expect(carriedText(core, builderId)).toHaveLength(20);
    });

    it('refuses a twenty-first, naming the limits decision', async () => {
      unwrap(await registry.assignLabel(plugin, { shipId: builderId, valueId: macos }));

      const refused = refusalOf(await registry.assignLabel(plugin, { shipId: builderId, valueId: hemma }));

      expect(refused.kind).toBe('SHIP_LABEL_LIMIT_REACHED');
      expect(refused.message).toContain('decision 0031');
      expect(carriedText(core, builderId)).toHaveLength(20);
    });

    it('still takes a value the ship carries, changing nothing', async () => {
      unwrap(await registry.assignLabel(plugin, { shipId: builderId, valueId: macos }));

      await expect(registry.assignLabel(plugin, { shipId: builderId, valueId: macos })).resolves.toMatchObject({ isOk: true });
    });
  });
});
