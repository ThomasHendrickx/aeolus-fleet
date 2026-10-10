import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { createRegisterNetworkPlugin } from './register-network-plugin.js';
import { createSetNetworkRules } from './set-network-rules.js';
import { createUnregisterNetworkPlugin } from './unregister-network-plugin.js';

let core: InMemoryCore;
let fleetId: FleetId;
let argo: Caller;
let plugin: Caller;
let unregisterNetworkPlugin: ReturnType<typeof createUnregisterNetworkPlugin>;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-10T08:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  plugin = await shipWithScopes({ registry: registryUseCases(core), argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  const deps = { uow: core.uow, clock: core.clock, ids: core.ids };
  unwrap(await createRegisterNetworkPlugin(deps)(plugin, { whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 }));
  unwrap(await createSetNetworkRules(deps)(plugin, { rules: [{ from: [], to: [] }] }));
  unregisterNetworkPlugin = createUnregisterNetworkPlugin(deps);
  core.state.events.length = 0;
});

describe('unregistering the networking plugin', () => {
  it('leaves the fleet without a plugin and without rules, all-to-all, at the next version', async () => {
    expect(unwrap(await unregisterNetworkPlugin(plugin))).toEqual({ version: 3 });
    expect(core.state.networkSettings).toEqual([{ fleetId, rules: null, version: 3, plugin: null }]);
  });

  it('writes NetworkPluginUnregistered, caused by the plugin, with the version', async () => {
    unwrap(await unregisterNetworkPlugin(plugin));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'NetworkPluginUnregistered',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: plugin.shipId },
        shipId: plugin.shipId,
        details: { version: 3 },
      }),
    ]);
  });

  it('refuses any ship but the plugin, argo too, and stores nothing', async () => {
    const refused = await unregisterNetworkPlugin(argo);

    expect(refusalOf(refused)).toEqual({ kind: 'NOT_THE_NETWORK_PLUGIN', message: "Only the fleet's networking plugin does this (decision 0035)" });
    expect(core.state.networkSettings).toEqual([expect.objectContaining({ version: 2, plugin: expect.objectContaining({ shipId: plugin.shipId }) })]);
    expect(core.state.events).toEqual([]);
  });

  it('refuses when no plugin is registered', async () => {
    unwrap(await unregisterNetworkPlugin(plugin));

    expect(refusalOf(await unregisterNetworkPlugin(plugin))).toMatchObject({ kind: 'NOT_THE_NETWORK_PLUGIN' });
  });
});
