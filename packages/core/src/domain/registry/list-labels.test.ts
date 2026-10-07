import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: Caller;
let plugin: Caller;
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
  it('lists every label by key, with its values and its owner by id and name', async () => {
    unwrap(await registry.defineLabel(plugin, { key: 'project', values: ['hemma', 'aeolus'] }));
    unwrap(await registry.defineLabel(argo, { key: 'os', values: ['macos', 'linux'] }));

    await expect(registry.listLabels(argo)).resolves.toEqual([
      { key: 'os', values: ['macos', 'linux'], owner: { id: argo.shipId, name: 'argo' } },
      { key: 'project', values: ['hemma', 'aeolus'], owner: { id: pluginId, name: 'trierarch-plugin' } },
    ]);
  });

  it("lists none for a fleet without labels, and never another fleet's", async () => {
    const other = await hostedFleet(core);
    unwrap(await registry.defineLabel({ ...argo, fleetId: other.fleetId, shipId: other.operatorShipId }, { key: 'os', values: ['macos'] }));

    await expect(registry.listLabels(argo)).resolves.toEqual([]);
  });
});
