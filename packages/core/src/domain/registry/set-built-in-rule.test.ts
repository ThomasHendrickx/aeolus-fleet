import { accountIdSchema, FIXED_BUILT_IN_RULES, type FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { AccountCaller, ShipCaller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let networking: ShipCaller;
let other: ShipCaller;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-18T16:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  other = await shipWithScopes({ registry, argo }, { name: 'reach', type: 'networking', scopes: ['fleet:network'] });
  core.state.events.length = 0;
});

function isViewerReadOn() {
  return core.state.networkSettings.find((settings) => settings.fleetId === fleetId)?.isViewerReadOn;
}

describe('open, which follows the applied rules (decision 0034)', () => {
  it('refuses turning it on or off, for argo as for any ship holding fleet:network, naming what it follows, and changes nothing', async () => {
    for (const caller of [argo, networking]) {
      for (const isOn of [false, true]) {
        expect(refusalOf(await registry.setBuiltInRule(caller, { rule: 'open', isOn }))).toEqual({
          kind: 'BUILT_IN_RULE_FIXED',
          message: 'The built-in rule open is on exactly while the fleet has no rules applied (decision 0034)',
        });
      }
    }
    expect(core.state.networkSettings).toEqual([]);
    expect(core.state.events).toEqual([]);
  });
});

describe('turning the viewer reading on or off (decision 0034)', () => {
  it('turns it off as argo, with BuiltInRuleChanged naming no verb', async () => {
    expect(unwrap(await registry.setBuiltInRule(argo, { rule: 'viewerRead', isOn: false }))).toEqual({ version: 1 });

    expect(isViewerReadOn()).toBe(false);
    expect(core.state.events).toEqual([expect.objectContaining({ type: 'BuiltInRuleChanged', details: { rule: 'viewerRead', isOn: false, version: 1 } })]);
  });

  it('turns it on again at the next version', async () => {
    unwrap(await registry.setBuiltInRule(argo, { rule: 'viewerRead', isOn: false }));

    expect(unwrap(await registry.setBuiltInRule(argo, { rule: 'viewerRead', isOn: true }))).toEqual({ version: 2 });
    expect(isViewerReadOn()).toBe(true);
  });

  it('changes nothing and writes no event when it is already as asked, answering the version it has', async () => {
    expect(unwrap(await registry.setBuiltInRule(argo, { rule: 'viewerRead', isOn: true }))).toEqual({ version: 0 });

    expect(core.state.events).toEqual([]);
  });

  it('lets any ship holding fleet:network turn it, not only argo, the event naming it (decision 0053)', async () => {
    unwrap(await registry.setBuiltInRule(other, { rule: 'viewerRead', isOn: false }));

    expect(isViewerReadOn()).toBe(false);
    expect(core.state.events.map(({ actor }) => actor)).toEqual([{ kind: 'ship', shipId: other.shipId }]);
  });

  it('lets an account holding fleet:network turn it, the event naming the account', async () => {
    const mathilde = accountIdSchema.parse('acc-mathilde');
    const account: AccountCaller = { kind: 'account', accountId: mathilde, fleetId, scopes: ['fleet:network'], groupValues: [], personShipId: null, throughShipId: null };

    unwrap(await registry.setBuiltInRule(account, { rule: 'viewerRead', isOn: false }));

    expect(core.state.events.map(({ actor }) => actor)).toEqual([{ kind: 'account', accountId: mathilde, throughShipId: null }]);
  });
});

describe('the built-in rules that are never off (decision 0034)', () => {
  it.each(FIXED_BUILT_IN_RULES)('refuses turning %s off, for argo as for any ship holding fleet:network, and changes nothing', async (rule) => {
    for (const caller of [argo, networking]) {
      expect(refusalOf(await registry.setBuiltInRule(caller, { rule, isOn: false }))).toEqual({ kind: 'BUILT_IN_RULE_FIXED', message: `The built-in rule ${rule} is never off (decision 0034)` });
    }
    expect(core.state.networkSettings).toEqual([]);
    expect(core.state.events).toEqual([]);
  });
});
