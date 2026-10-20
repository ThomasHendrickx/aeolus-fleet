import type { LabelValueId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { NetworkRule } from './network-settings.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;
let networking: ShipCaller;

/** A rule between selectors of fresh value ids: no label needs to exist, as an unknown id matches no ship. */
function aRule(from = 1, to = 1): NetworkRule {
  return { verb: 'send', from: valueIds(from), to: valueIds(to) };
}

function valueIds(count: number): LabelValueId[] {
  return Array.from({ length: count }, () => core.ids('labelValue'));
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-20T08:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  core.state.events.length = 0;
});

describe('discarding the draft (decision 0034)', () => {
  it('drops it, leaving the applied rules as they are, with NetworkRulesDraftDiscarded caused by the discarder', async () => {
    await applyNetworkRules(registry, networking, [aRule()]);
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: null }));
    core.state.events.length = 0;

    unwrap(await registry.discardNetworkRulesDraft(argo));

    expect(core.state.networkRulesDrafts).toEqual([]);
    expect(core.state.networkSettings).toEqual([expect.objectContaining({ rules: [expect.anything()], version: 1 })]);
    expect(core.state.events).toEqual([expect.objectContaining({ type: 'NetworkRulesDraftDiscarded', occurredAt: core.clock.now(), actor: { kind: 'ship', shipId: argo.shipId } })]);
  });

  it('refuses a fleet without a draft, writing nothing', async () => {
    expect(refusalOf(await registry.discardNetworkRulesDraft(networking))).toEqual({ kind: 'NO_NETWORK_RULES_DRAFT', message: 'The fleet has no draft of its network rules' });
    expect(core.state.events).toEqual([]);
  });
});
