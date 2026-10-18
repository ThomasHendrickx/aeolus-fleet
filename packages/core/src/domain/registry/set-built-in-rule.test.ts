import { FIXED_BUILT_IN_RULES, type FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { BUILT_INS_ON } from './network-settings.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let plugin: Caller;
let other: Caller;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-18T16:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  plugin = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  other = await shipWithScopes({ registry, argo }, { name: 'reach', type: 'networking', scopes: ['fleet:network'] });
  unwrap(await registry.registerNetworkPlugin(plugin, { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 120 }));
  core.state.events.length = 0;
});

function builtIns() {
  return core.state.networkSettings.find((settings) => settings.fleetId === fleetId)?.builtIns;
}

describe('turning open on or off (decision 0034)', () => {
  it('turns it off for one verb as the networking plugin, at the next version', async () => {
    expect(unwrap(await registry.setBuiltInRule(plugin, { rule: 'open', verb: 'send', isOn: false }))).toEqual({ version: 2 });

    expect(builtIns()).toEqual({ ...BUILT_INS_ON, open: { send: false, read: true, manage: true } });
  });

  it('writes BuiltInRuleChanged, caused by the plugin, with the rule, its verb, on or off and the version', async () => {
    unwrap(await registry.setBuiltInRule(plugin, { rule: 'open', verb: 'manage', isOn: false }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'BuiltInRuleChanged',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: plugin.shipId },
        details: { rule: 'open', verb: 'manage', isOn: false, version: 2 },
      }),
    ]);
  });

  it('turns it on again', async () => {
    unwrap(await registry.setBuiltInRule(plugin, { rule: 'open', verb: 'read', isOn: false }));

    expect(unwrap(await registry.setBuiltInRule(plugin, { rule: 'open', verb: 'read', isOn: true }))).toEqual({ version: 3 });
    expect(builtIns()).toEqual(BUILT_INS_ON);
  });

  it('changes nothing and writes no event when it is already as asked, answering the version it has', async () => {
    expect(unwrap(await registry.setBuiltInRule(plugin, { rule: 'open', verb: 'send', isOn: true }))).toEqual({ version: 1 });

    expect(core.state.events).toEqual([]);
  });

  it('refuses any ship but the networking plugin, argo too, and changes nothing', async () => {
    for (const caller of [argo, other]) {
      expect(refusalOf(await registry.setBuiltInRule(caller, { rule: 'open', verb: 'send', isOn: false }))).toMatchObject({ kind: 'NOT_THE_NETWORK_PLUGIN' });
    }
    expect(builtIns()).toEqual(BUILT_INS_ON);
    expect(core.state.events).toEqual([]);
  });
});

describe('turning the viewer reading on or off (decision 0034)', () => {
  it('turns it off as argo, with BuiltInRuleChanged naming no verb', async () => {
    expect(unwrap(await registry.setBuiltInRule(argo, { rule: 'viewerRead', isOn: false }))).toEqual({ version: 2 });

    expect(builtIns()).toEqual({ ...BUILT_INS_ON, isViewerReadOn: false });
    expect(core.state.events).toEqual([expect.objectContaining({ type: 'BuiltInRuleChanged', details: { rule: 'viewerRead', isOn: false, version: 2 } })]);
  });

  it('refuses any ship but argo, the networking plugin too', async () => {
    expect(refusalOf(await registry.setBuiltInRule(plugin, { rule: 'viewerRead', isOn: false }))).toEqual({
      kind: 'NOT_THE_OPERATOR_SHIP',
      message: 'Only argo turns the viewer reading on or off (decision 0034)',
    });
    expect(builtIns()).toEqual(BUILT_INS_ON);
  });
});

describe('the built-in rules that are never off (decision 0034)', () => {
  it.each(FIXED_BUILT_IN_RULES)('refuses turning %s off, for argo as for the plugin, and changes nothing', async (rule) => {
    for (const caller of [argo, plugin]) {
      expect(refusalOf(await registry.setBuiltInRule(caller, { rule, isOn: false }))).toEqual({ kind: 'BUILT_IN_RULE_FIXED', message: `The built-in rule ${rule} is never off (decision 0034)` });
    }
    expect(core.state.networkSettings.find((settings) => settings.fleetId === fleetId)?.version).toBe(1);
    expect(core.state.events).toEqual([]);
  });
});
