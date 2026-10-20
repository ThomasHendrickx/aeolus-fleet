import type { NetworkRule } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { agentCaller, applyNetworkRules, hostedFleet, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;

function aRule(): NetworkRule {
  return { verb: 'send', from: [core.ids('labelValue')], to: [] };
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-20T08:00:00.000Z');
  argo = operatorCaller(await initialiseFleet(core));
  registry = registryUseCases(core);
});

describe('reading the network rules (decision 0034)', () => {
  it('answers none applied at version 0 and no draft for a fleet that never set rules', async () => {
    expect(unwrap(await registry.readNetworkRules(argo))).toEqual({ applied: { rules: null, version: 0 }, draft: null });
  });

  it('answers the applied rules at the version the settings have, and the draft beside them', async () => {
    const applied = [aRule()];
    await applyNetworkRules(registry, { by: argo, rules: applied });
    core.clock.advance(60_000);
    const drafted = [aRule(), aRule()];
    unwrap(await registry.saveNetworkRulesDraft(argo, { rules: drafted }));

    expect(unwrap(await registry.readNetworkRules(argo))).toEqual({
      applied: { rules: applied, version: 1 },
      draft: { rules: drafted, savedAt: core.clock.now(), savedAgainstVersion: 1 },
    });
  });

  it("answers the caller's fleet only", async () => {
    unwrap(await registry.saveNetworkRulesDraft(argo, { rules: [aRule()] }));
    const other = await hostedFleet(core);

    expect(unwrap(await registry.readNetworkRules(agentCaller({ fleetId: other.fleetId, shipId: other.operatorShipId })))).toEqual({ applied: { rules: null, version: 0 }, draft: null });
  });
});
