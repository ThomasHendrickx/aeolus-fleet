import type { LabelValueId, NetworkRulesDraftChanges, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

/**
 * What the draft would change (decision 0034): planner and scout carry
 * trust shared, vault trust sensitive. The applied rules let shared ships
 * send to shared ships.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;
let planner: ShipCaller;
let scout: ShipCaller;
let vault: ShipCaller;

function value(text: string): LabelValueId {
  return valueIdOf(core, { key: 'trust', value: text });
}

/** The pairs of a list of changes, by name, sorted, so the order the answer keeps does not matter here. */
function pairs(changes: NetworkRulesDraftChanges['send']['gained']): string[] {
  const names = new Map<ShipId, string>([argo, planner, scout, vault].map((ship, index) => [ship.shipId, ['argo', 'planner', 'scout', 'vault'][index] ?? '']));
  return changes.map(({ fromShipId, toShipId }) => `${names.get(fromShipId) ?? fromShipId}>${names.get(toShipId) ?? toShipId}`).sort();
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-20T08:00:00.000Z');
  argo = operatorCaller(await initialiseFleet(core));
  registry = registryUseCases(core);
  planner = await shipWithScopes({ registry, argo }, { name: 'planner', type: 'planner', scopes: ['fleet:network'] });
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  vault = await shipWithScopes({ registry, argo }, { name: 'vault', type: 'keeper', scopes: [] });
  unwrap(await registry.defineLabel(argo, { key: 'trust', values: ['shared', 'sensitive'] }));
  for (const [ship, text] of [
    [planner, 'shared'],
    [scout, 'shared'],
    [vault, 'sensitive'],
  ] as const) {
    unwrap(await registry.assignLabel(argo, { shipId: ship.shipId, valueId: value(text) }));
  }
  await applyNetworkRules(registry, { by: argo, rules: [{ verb: 'send', from: [value('shared')], to: [value('shared')] }] });
});

describe('the reach a draft would change (decision 0034)', () => {
  it('answers per verb the pairs of ships the draft gains and loses, each with the rule that allows it on the side that has it', async () => {
    unwrap(await registry.saveNetworkRulesDraft(argo, { rules: [{ verb: 'send', from: [value('shared')], to: [value('sensitive')] }] }));

    const changes = unwrap(await registry.readNetworkRulesDraftChanges(argo));

    expect([pairs(changes.send.gained), pairs(changes.send.lost)]).toEqual([
      ['planner>vault', 'scout>vault'],
      ['planner>scout', 'scout>planner'],
    ]);
    expect([...changes.send.gained, ...changes.send.lost].map(({ rule }) => rule)).toEqual([{ rule: 0 }, { rule: 0 }, { rule: 0 }, { rule: 0 }]);
    expect([changes.read, changes.manage]).toEqual([
      { gained: [], lost: [] },
      { gained: [], lost: [] },
    ]);
  });

  it('answers a draft of none gaining, by open, every reach the applied rules leave out', async () => {
    unwrap(await registry.saveNetworkRulesDraft(argo, { rules: null }));

    const changes = unwrap(await registry.readNetworkRulesDraftChanges(argo));

    expect(pairs(changes.send.gained)).toEqual(['planner>vault', 'scout>vault', 'vault>planner', 'vault>scout']);
    expect(changes.send.gained.every(({ rule }) => 'builtIn' in rule && rule.builtIn === 'open')).toBe(true);
    expect(pairs(changes.read.gained)).toEqual(['planner>argo', 'planner>scout', 'planner>vault', 'scout>argo', 'scout>planner', 'scout>vault', 'vault>argo', 'vault>planner', 'vault>scout']);
    expect([changes.send.lost, changes.read.lost, changes.manage.lost]).toEqual([[], [], []]);
  });

  it('answers no change for a draft the same as the applied rules', async () => {
    unwrap(await registry.saveNetworkRulesDraft(argo, { rules: [{ verb: 'send', from: [value('shared')], to: [value('shared')] }] }));

    expect(unwrap(await registry.readNetworkRulesDraftChanges(argo))).toEqual({
      send: { gained: [], lost: [] },
      read: { gained: [], lost: [] },
      manage: { gained: [], lost: [] },
    });
  });

  it('answers only pairs of ships the caller reads', async () => {
    unwrap(await registry.saveNetworkRulesDraft(planner, { rules: null }));

    expect(unwrap(await registry.readNetworkRulesDraftChanges(planner))).toEqual({
      send: { gained: [], lost: [] },
      read: { gained: [], lost: [] },
      manage: { gained: [], lost: [] },
    });
  });

  it('refuses a fleet without a draft', async () => {
    expect(refusalOf(await registry.readNetworkRulesDraftChanges(argo))).toEqual({ kind: 'NO_NETWORK_RULES_DRAFT', message: 'The fleet has no draft of its network rules' });
  });
});
