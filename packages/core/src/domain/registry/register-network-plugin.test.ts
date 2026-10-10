import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { createRegisterNetworkPlugin } from './register-network-plugin.js';

let core: InMemoryCore;
let fleetId: FleetId;
let argo: Caller;
let plugin: Caller;
let registerNetworkPlugin: ReturnType<typeof createRegisterNetworkPlugin>;

const BLOCK_ALL = { whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 } as const;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-10T08:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  plugin = await shipWithScopes({ registry: registryUseCases(core), argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  registerNetworkPlugin = createRegisterNetworkPlugin({ uow: core.uow, clock: core.clock, ids: core.ids });
  core.state.events.length = 0;
});

describe('registering a networking plugin', () => {
  it("makes the caller's ship the fleet's networking plugin, with what it declared, at the next version", async () => {
    expect(unwrap(await registerNetworkPlugin(plugin, BLOCK_ALL))).toEqual({ version: 1 });
    expect(core.state.networkSettings).toEqual([{ fleetId, rules: null, version: 1, plugin: { shipId: plugin.shipId, ...BLOCK_ALL } }]);
  });

  it('starts from no rules, as a fleet without a plugin has none, until it supplies its own', async () => {
    unwrap(await registerNetworkPlugin(plugin, BLOCK_ALL));

    expect(core.state.networkSettings).toEqual([expect.objectContaining({ rules: null, version: 1 })]);
  });

  it('writes NetworkPluginRegistered, caused by the plugin, with the version and what it declared', async () => {
    unwrap(await registerNetworkPlugin(plugin, BLOCK_ALL));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'NetworkPluginRegistered',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: plugin.shipId },
        shipId: plugin.shipId,
        details: { version: 1, ...BLOCK_ALL },
      }),
    ]);
  });

  it('lets the plugin register again, replacing what it declared', async () => {
    unwrap(await registerNetworkPlugin(plugin, BLOCK_ALL));
    const keepLatest = { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 600 } as const;

    expect(unwrap(await registerNetworkPlugin(plugin, keepLatest))).toEqual({ version: 2 });
    expect(core.state.networkSettings).toEqual([expect.objectContaining({ plugin: { shipId: plugin.shipId, ...keepLatest } })]);
  });

  it('refuses a second plugin while one is registered, and stores nothing', async () => {
    unwrap(await registerNetworkPlugin(plugin, BLOCK_ALL));
    core.state.events.length = 0;
    const second = await shipWithScopes({ registry: registryUseCases(core), argo }, { name: 'networking-two', type: 'networking', scopes: ['fleet:network'] });
    core.state.events.length = 0;

    const refused = await registerNetworkPlugin(second, { whileUnavailable: 'open-all', notRespondingAfterSeconds: 60 });

    expect(refusalOf(refused)).toEqual({ kind: 'NETWORK_PLUGIN_REGISTERED', message: 'The fleet already has a networking plugin; it unregisters first (decision 0035)' });
    expect(core.state.networkSettings).toEqual([expect.objectContaining({ version: 1, plugin: { shipId: plugin.shipId, ...BLOCK_ALL } })]);
    expect(core.state.events).toEqual([]);
  });
});
