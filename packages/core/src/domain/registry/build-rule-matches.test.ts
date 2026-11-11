import type { FleetId, LabelValueId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { createBuildRuleMatches } from './build-rule-matches.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;

beforeEach(async () => {
  core = createInMemoryCore('2026-11-11T08:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
});

async function aCarrierUnderARule(): Promise<{ valueId: LabelValueId }> {
  const label = unwrap(await registry.defineLabel(argo, { key: 'team', values: ['red'] }));
  const valueId = label.values[0]?.id;
  if (valueId === undefined) {
    throw new Error('The label has its value');
  }
  const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: 'carrier', name: 'carrier', type: 'builder' }));
  unwrap(await registry.assignLabel(argo, { shipId, valueId }));
  const saved = unwrap(await registry.saveNetworkRulesDraft(argo, { rules: [{ verb: 'send', from: [], to: [valueId] }] }));
  unwrap(await registry.applyNetworkRules(argo, { version: saved.savedAgainstVersion }));
  return { valueId };
}

describe('building the rule matches of every fleet before core serves (rule-matches.md Q3, rollout A)', () => {
  it('fills a populated fleet whose matches were never built, and changes nothing when run again', async () => {
    // Given a fleet with a carrier under a rule, as a release finds it: no rule matches stored yet.
    await aCarrierUnderARule();
    const kept = [...core.state.ruleMatches];
    expect(kept.length).toBeGreaterThan(0);
    core.state.ruleMatches.length = 0;

    // When the build runs, and then once more.
    const build = createBuildRuleMatches({ uow: core.uow });
    const built = unwrap(await build());
    const first = structuredClone(core.state.ruleMatches);
    unwrap(await build());

    // Then the fleet holds the matches its writers would have kept, and a second run leaves them as they are.
    expect(built).toEqual({ fleets: 1 });
    expect(first).toEqual(kept);
    expect(core.state.ruleMatches).toEqual(first);
    expect(fleetId).toBe(first[0]?.fleetId);
  });
});
