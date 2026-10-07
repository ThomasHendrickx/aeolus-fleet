import type { FleetId, LabelId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let plugin: Caller;
let pluginId: ShipId;
let osId: LabelId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-07T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['fleet:read', 'labels:define', 'labels:assign'] });
  pluginId = plugin.shipId;
  ({ labelId: osId } = unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] })));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

/** A ship carrying the value, straight into the state, as an assignment leaves it. */
async function shipCarrying(name: string, value: string): Promise<ShipId> {
  const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'implementer' }));
  core.state.shipLabels.push({ fleetId, shipId, labelId: osId, valueId: valueIdOf(core, 'os', value) });
  core.state.events.length = 0;
  return shipId;
}

function valuesOfOs() {
  return core.state.labels.find((label) => label.id === osId)?.values;
}

describe("changing a label's values", () => {
  it('lets its owner add a value: the values it had keep their ids, the new one gets its own', async () => {
    const before = valuesOfOs() ?? [];

    const changed = unwrap(await registry.changeLabelValues(plugin, { labelId: osId, values: ['macos', 'linux', 'windows'] }));

    expect(changed.values.slice(0, 2)).toEqual(before);
    expect(changed.values[2]?.value).toBe('windows');
    expect(changed.values[2]?.id).toMatch(/^lbv_/);
    expect(valuesOfOs()).toEqual(changed.values);
  });

  it('writes LabelValuesChanged, caused by its owner and naming it, with the label and the values it has now, ids and text', async () => {
    const changed = unwrap(await registry.changeLabelValues(plugin, { labelId: osId, values: ['macos', 'linux', 'windows'] }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'LabelValuesChanged',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: pluginId },
        shipId: pluginId,
        details: { labelId: osId, key: 'os', values: 'macos,linux,windows', valueIds: changed.values.map((value) => value.id).join(',') },
      }),
    ]);
  });

  it('lets its owner remove a value no ship carries', async () => {
    await shipCarrying('builder', 'macos');

    unwrap(await registry.changeLabelValues(plugin, { labelId: osId, values: ['macos'] }));

    expect(valuesOfOs()?.map((value) => value.value)).toEqual(['macos']);
  });

  it('refuses to remove a value ships carry, naming them, and changes nothing', async () => {
    await shipCarrying('builder', 'linux');
    await shipCarrying('tester', 'linux');

    const refused = refusalOf(await registry.changeLabelValues(plugin, { labelId: osId, values: ['macos'] }));

    expect(refused).toEqual({ kind: 'LABEL_VALUE_CARRIED', message: 'Ships carry os=linux: builder, tester' });
    expect(valuesOfOs()?.map((value) => value.value)).toEqual(['macos', 'linux']);
    expect(core.state.events).toEqual([]);
  });

  it('changes nothing and writes no event for the values it has, in any order', async () => {
    const before = valuesOfOs();

    unwrap(await registry.changeLabelValues(plugin, { labelId: osId, values: ['linux', 'macos'] }));

    expect(valuesOfOs()).toEqual(before);
    expect(core.state.events).toEqual([]);
  });

  it('refuses a ship that does not own the label, argo too', async () => {
    const refused = refusalOf(await registry.changeLabelValues(argo, { labelId: osId, values: ['macos'] }));

    expect(refused).toEqual({ kind: 'NOT_THE_LABEL_OWNER', message: 'The label os is owned by trierarch-plugin: only its owner changes it' });
    expect(valuesOfOs()?.map((value) => value.value)).toEqual(['macos', 'linux']);
  });

  it('refuses a label the fleet does not have', async () => {
    await expect(registry.changeLabelValues(plugin, { labelId: core.ids('label'), values: ['hemma'] })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'LABEL_NOT_FOUND' },
    });
  });

  it('takes exactly 50 values and refuses 51, naming the limits decision', async () => {
    const fifty = Array.from({ length: 50 }, (_, index) => `v${String(index)}`);

    await expect(registry.changeLabelValues(plugin, { labelId: osId, values: ['macos', 'linux', ...fifty.slice(2)] })).resolves.toMatchObject({ isOk: true });
    const refused = refusalOf(await registry.changeLabelValues(plugin, { labelId: osId, values: ['macos', 'linux', ...fifty.slice(1)] }));
    expect(refused.kind).toBe('INVALID_LABEL_VALUES');
    expect(refused.message).toContain('decision 0031');
  });

  it('refuses a value outside the limits', async () => {
    await expect(registry.changeLabelValues(plugin, { labelId: osId, values: ['macos', 'Windows'] })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_LABEL_VALUE' },
    });
  });
});
