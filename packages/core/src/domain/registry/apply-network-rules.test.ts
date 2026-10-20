import { accountIdSchema, type FleetId, type LabelValueId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { AccountCaller, ShipCaller } from '../shared/caller.js';
import type { NetworkRule } from './network-settings.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let networking: ShipCaller;

/** A rule between selectors of fresh value ids: no label needs to exist, as an unknown id matches no ship. */
function aRule(): NetworkRule {
  return { verb: 'send', from: [valueId()], to: [valueId()] };
}

function valueId(): LabelValueId {
  return core.ids('labelValue');
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-20T08:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  core.state.events.length = 0;
});

describe('applying the draft of the network rules (decision 0034)', () => {
  it('makes the draft the applied rules at the next version, and drops the draft', async () => {
    const rules = [aRule(), { ...aRule(), verb: 'manage' as const }];
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules }));

    expect(unwrap(await registry.applyNetworkRules(networking, { version: 0 }))).toEqual({ version: 1 });
    expect(core.state.networkSettings).toEqual([{ fleetId, rules, isViewerReadOn: true, version: 1 }]);
    expect(core.state.networkRulesDrafts).toEqual([]);
  });

  it('applies none as all-to-all again, open on', async () => {
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: [] }));
    unwrap(await registry.applyNetworkRules(networking, { version: 0 }));
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: null }));

    expect(unwrap(await registry.applyNetworkRules(networking, { version: 1 }))).toEqual({ version: 2 });
    expect(core.state.networkSettings).toEqual([{ fleetId, rules: null, isViewerReadOn: true, version: 2 }]);
  });

  it('writes NetworkRulesSet, caused by the applier, with the version and how many rules, none for all-to-all', async () => {
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: [aRule(), aRule()] }));
    unwrap(await registry.applyNetworkRules(networking, { version: 0 }));
    unwrap(await registry.saveNetworkRulesDraft(argo, { rules: null }));
    unwrap(await registry.applyNetworkRules(argo, { version: 1 }));

    expect(core.state.events.filter(({ type }) => type === 'NetworkRulesSet')).toEqual([
      expect.objectContaining({ occurredAt: core.clock.now(), actor: { kind: 'ship', shipId: networking.shipId }, details: { version: 1, rules: 2 } }),
      expect.objectContaining({ occurredAt: core.clock.now(), actor: { kind: 'ship', shipId: argo.shipId }, details: { version: 2, rules: null } }),
    ]);
  });

  it('lets any actor holding fleet:network apply a draft another saved, an account too (decision 0053)', async () => {
    const mathilde = accountIdSchema.parse('acc-mathilde');
    const account: AccountCaller = { kind: 'account', accountId: mathilde, fleetId, scopes: ['fleet:network'], groupValues: [], personShipId: null, throughShipId: null };
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: [aRule()] }));

    expect(unwrap(await registry.applyNetworkRules(account, { version: 0 }))).toEqual({ version: 1 });
    expect(core.state.events.at(-1)).toMatchObject({ type: 'NetworkRulesSet', actor: { kind: 'account', accountId: mathilde, throughShipId: null } });
  });

  it('refuses a fleet without a draft, changing and writing nothing', async () => {
    expect(refusalOf(await registry.applyNetworkRules(networking, { version: 0 }))).toEqual({ kind: 'NO_NETWORK_RULES_DRAFT', message: 'The fleet has no draft of its network rules' });
    expect(core.state.networkSettings).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it('refuses when the settings moved past the version the caller saw, so what applies is what was previewed, keeping the draft', async () => {
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: [aRule()] }));
    unwrap(await registry.setBuiltInRule(argo, { rule: 'viewerRead', isOn: false }));
    core.state.events.length = 0;

    expect(refusalOf(await registry.applyNetworkRules(networking, { version: 0 }))).toEqual({
      kind: 'NETWORK_SETTINGS_CHANGED',
      message: 'The network settings are at version 1 now, not 0: look at the draft again before applying it',
    });
    expect(core.state.networkSettings).toEqual([{ fleetId, rules: null, isViewerReadOn: false, version: 1 }]);
    expect(core.state.networkRulesDrafts).toEqual([expect.objectContaining({ rules: [expect.anything()] })]);
    expect(core.state.events).toEqual([]);
  });

  it('applies against the version the settings have now, whatever version the draft was saved against', async () => {
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: [aRule()] }));
    unwrap(await registry.setBuiltInRule(argo, { rule: 'viewerRead', isOn: false }));

    expect(unwrap(await registry.applyNetworkRules(networking, { version: 1 }))).toEqual({ version: 2 });
  });
});
