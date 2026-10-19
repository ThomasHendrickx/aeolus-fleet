import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { agentCaller, hostedFleet, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { createReadBuiltInRules } from './read-built-in-rules.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let readBuiltInRules: ReturnType<typeof createReadBuiltInRules>;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-18T16:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  readBuiltInRules = createReadBuiltInRules({ uow: core.uow });
});

describe('reading the built-in rules (decision 0034)', () => {
  it('answers every built-in rule in the order the rule list shows them, all on for a fleet that never changed them', async () => {
    expect(unwrap(await readBuiltInRules(argo))).toEqual([
      { rule: 'argo', isOn: true },
      { rule: 'owner', isOn: true },
      { rule: 'answer', isOn: true },
      { rule: 'pluginRead', isOn: true },
      { rule: 'viewerRead', isOn: true },
      { rule: 'open', verb: 'send', isOn: true },
      { rule: 'open', verb: 'read', isOn: true },
      { rule: 'open', verb: 'manage', isOn: true },
    ]);
  });

  it('answers each rule that can be off as it was turned', async () => {
    const plugin = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
    unwrap(await registry.registerNetworkPlugin(plugin, { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 120 }));
    unwrap(await registry.setBuiltInRule(plugin, { rule: 'open', verb: 'read', isOn: false }));
    unwrap(await registry.setBuiltInRule(argo, { rule: 'viewerRead', isOn: false }));

    expect(unwrap(await readBuiltInRules(argo))).toEqual([
      { rule: 'argo', isOn: true },
      { rule: 'owner', isOn: true },
      { rule: 'answer', isOn: true },
      { rule: 'pluginRead', isOn: true },
      { rule: 'viewerRead', isOn: false },
      { rule: 'open', verb: 'send', isOn: true },
      { rule: 'open', verb: 'read', isOn: false },
      { rule: 'open', verb: 'manage', isOn: true },
    ]);
  });

  it("answers the caller's fleet only", async () => {
    unwrap(await registry.setBuiltInRule(argo, { rule: 'viewerRead', isOn: false }));
    const other = await hostedFleet(core);

    expect(unwrap(await readBuiltInRules(agentCaller({ fleetId: other.fleetId, shipId: other.operatorShipId })))).toContainEqual({ rule: 'viewerRead', isOn: true });
    expect(fleetId).not.toBe(other.fleetId);
  });
});
