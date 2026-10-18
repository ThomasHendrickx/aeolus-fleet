import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { agentCaller, hostedFleet, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { createReadNetworkPlugin } from './read-network-plugin.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let plugin: Caller;
let readNetworkPlugin: ReturnType<typeof createReadNetworkPlugin>;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-18T16:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  plugin = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  readNetworkPlugin = createReadNetworkPlugin({ uow: core.uow });
});

describe("reading the fleet's networking plugin (interop I-3)", () => {
  it('answers none for a fleet without one', async () => {
    expect(unwrap(await readNetworkPlugin(argo))).toBeNull();
  });

  it('answers its ship and when it registered', async () => {
    unwrap(await registry.registerNetworkPlugin(plugin, { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 120 }));

    expect(unwrap(await readNetworkPlugin(argo))).toEqual({ shipId: plugin.shipId, registeredAt: new Date('2026-10-18T16:00:00.000Z') });
  });

  it('keeps when it first registered when it registers again, replacing what it declared', async () => {
    unwrap(await registry.registerNetworkPlugin(plugin, { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 120 }));
    core.clock.advance(60_000);
    unwrap(await registry.registerNetworkPlugin(plugin, { whileUnavailable: 'block-all', notRespondingAfterSeconds: 300 }));

    expect(unwrap(await readNetworkPlugin(argo))).toEqual({ shipId: plugin.shipId, registeredAt: new Date('2026-10-18T16:00:00.000Z') });
  });

  it('answers none once it unregisters', async () => {
    unwrap(await registry.registerNetworkPlugin(plugin, { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 120 }));
    unwrap(await registry.unregisterNetworkPlugin(plugin));

    expect(unwrap(await readNetworkPlugin(argo))).toBeNull();
  });

  it("answers the caller's fleet only", async () => {
    unwrap(await registry.registerNetworkPlugin(plugin, { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 120 }));
    const other = await hostedFleet(core);

    expect(unwrap(await readNetworkPlugin(agentCaller({ fleetId: other.fleetId, shipId: other.operatorShipId })))).toBeNull();
    expect(fleetId).not.toBe(other.fleetId);
  });
});
