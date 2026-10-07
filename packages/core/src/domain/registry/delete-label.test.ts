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
  core.state.shipLabels.push({ fleetId, shipId, labelId: osId, valueId: valueIdOf(core, { key: 'os', value }) });
  core.state.events.length = 0;
  return shipId;
}

describe('deleting a label', () => {
  it('lets its owner delete it, with its values', async () => {
    unwrap(await registry.deleteLabel(plugin, { labelId: osId }));

    expect(core.state.labels).toEqual([]);
  });

  it('writes LabelDeleted, caused by its owner and naming it, with the label', async () => {
    unwrap(await registry.deleteLabel(plugin, { labelId: osId }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'LabelDeleted',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: pluginId },
        shipId: pluginId,
        details: { labelId: osId, key: 'os' },
      }),
    ]);
  });

  it('frees the key: the fleet may define it again', async () => {
    unwrap(await registry.deleteLabel(plugin, { labelId: osId }));

    await expect(registry.defineLabel(argo, { key: 'os', values: ['windows'] })).resolves.toMatchObject({ isOk: true });
  });

  it('refuses while a ship carries any of its values, naming the ships, and deletes nothing', async () => {
    await shipCarrying('builder', 'macos');
    await shipCarrying('tester', 'linux');

    const refused = refusalOf(await registry.deleteLabel(plugin, { labelId: osId }));

    expect(refused).toEqual({ kind: 'LABEL_CARRIED', message: 'Ships carry the label os: builder, tester' });
    expect(core.state.labels.map((label) => label.id)).toEqual([osId]);
    expect(core.state.events).toEqual([]);
  });

  it('refuses a ship that is not its owner', async () => {
    const refused = refusalOf(await registry.deleteLabel(argo, { labelId: osId }));

    expect(refused).toEqual({ kind: 'NOT_THE_LABEL_OWNER', message: 'The label os is owned by trierarch-plugin: only its owner deletes it' });
    expect(core.state.labels.map((label) => label.id)).toEqual([osId]);
  });

  it('refuses a label the fleet does not have', async () => {
    await expect(registry.deleteLabel(plugin, { labelId: core.ids('label') })).resolves.toMatchObject({ isOk: false, error: { kind: 'LABEL_NOT_FOUND' } });
  });
});
