import { ANY_LABEL_VALUE, NETWORK_RULES_MAX, SAME_LABEL_VALUE, SHIP_LABELS_MAX, type FleetId, type LabelValueId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import type { NetworkRule } from './network-settings.js';
import { createRegisterNetworkPlugin } from './register-network-plugin.js';
import { createSetNetworkRules } from './set-network-rules.js';

let core: InMemoryCore;
let fleetId: FleetId;
let argo: Caller;
let setter: Caller;
let other: Caller;
let setNetworkRules: ReturnType<typeof createSetNetworkRules>;

/** A rule between selectors of fresh value ids: no label needs to exist, as an unknown id matches no ship. */
function aRule(from = 1, to = 1): NetworkRule {
  return { from: valueIds(from), to: valueIds(to) };
}

const DECLARATION = { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 120 } as const;

/** The fleet's networking plugin as the settings hold it, once the setter registered. */
function plugin() {
  return { shipId: setter.shipId, ...DECLARATION };
}

function valueIds(count: number): LabelValueId[] {
  return Array.from({ length: count }, () => core.ids('labelValue'));
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-09T19:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  setter = await shipWithScopes({ registry: registryUseCases(core), argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  other = await shipWithScopes({ registry: registryUseCases(core), argo }, { name: 'reach', type: 'networking', scopes: ['fleet:network'] });
  setNetworkRules = createSetNetworkRules({ uow: core.uow, clock: core.clock, ids: core.ids });
  core.state.events.length = 0;
});

describe('setting the network rules as the networking plugin', () => {
  beforeEach(async () => {
    unwrap(await createRegisterNetworkPlugin({ uow: core.uow, clock: core.clock, ids: core.ids })(setter, DECLARATION));
    core.state.events.length = 0;
  });

  it('keeps the whole list of rules for the fleet at the next version', async () => {
    const rules = [aRule(2, 1), aRule(0, 0)];

    const set = unwrap(await setNetworkRules(setter, { rules }));

    expect(set).toEqual({ version: 2 });
    expect(core.state.networkSettings).toEqual([{ fleetId, rules, version: 2, plugin: plugin() }]);
  });

  it('replaces the rules and moves the version on every set', async () => {
    unwrap(await setNetworkRules(setter, { rules: [aRule()] }));
    const rules = [aRule()];

    expect(unwrap(await setNetworkRules(setter, { rules }))).toEqual({ version: 3 });
    expect(core.state.networkSettings).toEqual([{ fleetId, rules, version: 3, plugin: plugin() }]);
  });

  it('keeps an empty list as rules that allow only the fixed exceptions', async () => {
    unwrap(await setNetworkRules(setter, { rules: [] }));

    expect(core.state.networkSettings).toEqual([{ fleetId, rules: [], version: 2, plugin: plugin() }]);
  });

  it('clears the rules with none, back to all-to-all, moving the version', async () => {
    unwrap(await setNetworkRules(setter, { rules: [aRule()] }));

    expect(unwrap(await setNetworkRules(setter, { rules: null }))).toEqual({ version: 3 });
    expect(core.state.networkSettings).toEqual([{ fleetId, rules: null, version: 3, plugin: plugin() }]);
  });

  it('writes NetworkRulesSet, caused by the setting ship, with the version and how many rules', async () => {
    unwrap(await setNetworkRules(setter, { rules: [aRule(), aRule()] }));
    unwrap(await setNetworkRules(setter, { rules: null }));

    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'NetworkRulesSet', occurredAt: core.clock.now(), actor: { kind: 'ship', shipId: setter.shipId }, details: { version: 2, rules: 2 } }),
      expect.objectContaining({ type: 'NetworkRulesSet', occurredAt: core.clock.now(), actor: { kind: 'ship', shipId: setter.shipId }, details: { version: 3, rules: null } }),
    ]);
  });

  it(`takes ${String(NETWORK_RULES_MAX)} rules, the limit`, async () => {
    const rules = Array.from({ length: NETWORK_RULES_MAX }, () => aRule());

    expect(unwrap(await setNetworkRules(setter, { rules }))).toEqual({ version: 2 });
  });

  it('refuses one rule over the limit, naming it and its decision, and stores nothing', async () => {
    const rules = Array.from({ length: NETWORK_RULES_MAX + 1 }, () => aRule());

    const refused = await setNetworkRules(setter, { rules });

    expect(refusalOf(refused)).toEqual({ kind: 'INVALID_NETWORK_RULES', message: 'A fleet holds at most 200 network rules of argo\'s plus the 0 its ships declared (decision 0037)' });
    expect(core.state.networkSettings).toEqual([expect.objectContaining({ rules: null, version: 1 })]);
    expect(core.state.events).toEqual([]);
  });

  it("takes argo's 200 rules plus every rule its ships declared, the limit (decision 0037)", async () => {
    core.state.declaredNetworkRules.push({ fleetId, shipId: other.shipId, rules: [aRule(), aRule(), aRule()] });
    const rules = Array.from({ length: NETWORK_RULES_MAX + 3 }, () => aRule());

    expect(unwrap(await setNetworkRules(setter, { rules }))).toEqual({ version: 2 });
  });

  it('refuses one rule more than argo\'s 200 and the declared ones, naming both and the decision', async () => {
    core.state.declaredNetworkRules.push({ fleetId, shipId: other.shipId, rules: [aRule(), aRule(), aRule()] });
    const rules = Array.from({ length: NETWORK_RULES_MAX + 4 }, () => aRule());

    expect(refusalOf(await setNetworkRules(setter, { rules }))).toEqual({
      kind: 'INVALID_NETWORK_RULES',
      message: "A fleet holds at most 200 network rules of argo's plus the 3 its ships declared (decision 0037)",
    });
  });

  it(`takes a selector of ${String(SHIP_LABELS_MAX)} terms, as many label values as a ship carries`, async () => {
    expect(unwrap(await setNetworkRules(setter, { rules: [aRule(SHIP_LABELS_MAX, SHIP_LABELS_MAX)] }))).toEqual({ version: 2 });
  });

  it('refuses a selector of one term more, naming the limit and its decision', async () => {
    const refused = await setNetworkRules(setter, { rules: [aRule(1, SHIP_LABELS_MAX + 1)] });

    expect(refusalOf(refused)).toEqual({ kind: 'INVALID_NETWORK_RULES', message: 'A selector holds at most 20 terms, as a ship carries no more label values (decision 0034)' });
    expect(core.state.networkSettings).toEqual([expect.objectContaining({ rules: null, version: 1 })]);
  });

  it('refuses a selector that holds an exact value twice', async () => {
    const valueId = core.ids('labelValue');

    const refused = await setNetworkRules(setter, { rules: [{ from: [valueId, valueId], to: [] }] });

    expect(refusalOf(refused)).toEqual({ kind: 'INVALID_NETWORK_RULES', message: `A selector holds each term once: ${valueId} twice (decision 0034)` });
    expect(core.state.networkSettings).toEqual([expect.objectContaining({ rules: null, version: 1 })]);
  });

  it('keeps terms of any value and of the same value, the latter on both sides', async () => {
    const labelId = core.ids('label');
    const rules = [{ from: [{ labelId, value: ANY_LABEL_VALUE }, { labelId, value: SAME_LABEL_VALUE }], to: [core.ids('labelValue'), { labelId, value: SAME_LABEL_VALUE }] }];

    expect(unwrap(await setNetworkRules(setter, { rules }))).toEqual({ version: 2 });
    expect(core.state.networkSettings).toEqual([{ fleetId, rules, version: 2, plugin: plugin() }]);
  });

  it('refuses a selector that holds a term of any value twice for one label', async () => {
    const labelId = core.ids('label');

    const refused = await setNetworkRules(setter, { rules: [{ from: [], to: [{ labelId, value: ANY_LABEL_VALUE }, { labelId, value: ANY_LABEL_VALUE }] }] });

    expect(refusalOf(refused)).toEqual({ kind: 'INVALID_NETWORK_RULES', message: `A selector holds each term once: ${labelId}=* twice (decision 0034)` });
  });

  it('refuses a term of the same value on the sending side only, and stores nothing', async () => {
    const labelId = core.ids('label');

    const refused = await setNetworkRules(setter, { rules: [{ from: [{ labelId, value: SAME_LABEL_VALUE }], to: [] }] });

    expect(refusalOf(refused)).toEqual({ kind: 'INVALID_NETWORK_RULES', message: `A term of the same value binds its label on both sides: ${labelId}=# is on one side only (decision 0034)` });
    expect(core.state.networkSettings).toEqual([expect.objectContaining({ rules: null, version: 1 })]);
  });

  it('refuses a term of the same value on the receiving side only', async () => {
    const labelId = core.ids('label');

    const refused = await setNetworkRules(setter, { rules: [{ from: [{ labelId, value: ANY_LABEL_VALUE }], to: [{ labelId, value: SAME_LABEL_VALUE }] }] });

    expect(refusalOf(refused)).toEqual({ kind: 'INVALID_NETWORK_RULES', message: `A term of the same value binds its label on both sides: ${labelId}=# is on one side only (decision 0034)` });
  });

  it('refuses terms of the same value that bind two different labels: each is on one side only', async () => {
    const [squadron, env] = [core.ids('label'), core.ids('label')];

    const refused = await setNetworkRules(setter, { rules: [{ from: [{ labelId: squadron, value: SAME_LABEL_VALUE }], to: [{ labelId: env, value: SAME_LABEL_VALUE }] }] });

    expect(refusalOf(refused)).toEqual({ kind: 'INVALID_NETWORK_RULES', message: `A term of the same value binds its label on both sides: ${squadron}=# is on one side only (decision 0034)` });
  });

  it("is the plugin of its own fleet only: another fleet's operator is refused there", async () => {
    const elsewhere = await hostedFleet(core, 'other@example.com');

    unwrap(await setNetworkRules(setter, { rules: [aRule()] }));
    const refused = await setNetworkRules({ shipId: elsewhere.operatorShipId, fleetId: elsewhere.fleetId, kind: 'operator', scopes: argo.scopes }, { rules: null });

    expect(refusalOf(refused)).toMatchObject({ kind: 'NOT_THE_NETWORK_PLUGIN' });
    expect(core.state.networkSettings.map((settings) => [settings.fleetId, settings.version, settings.rules?.length ?? null])).toEqual([[fleetId, 2, 1]]);
  });
});

describe('setting the network rules as any ship but the networking plugin (decision 0035)', () => {
  it.each([
    ['argo', () => argo],
    ['a ship with fleet:network', () => setter],
  ])('refuses %s while the fleet has no networking plugin, and stores nothing: rules exist only through a registered plugin', async (_who, caller) => {
    const refused = await setNetworkRules(caller(), { rules: [aRule()] });

    expect(refusalOf(refused)).toEqual({ kind: 'NOT_THE_NETWORK_PLUGIN', message: "Only the fleet's networking plugin does this (decision 0035)" });
    expect(core.state.networkSettings).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it.each([
    ['argo', () => argo],
    ['another ship with fleet:network', () => other],
  ])('refuses %s while a networking plugin is registered, and stores nothing: the plugin is the one owner of the rules', async (_who, caller) => {
    unwrap(await createRegisterNetworkPlugin({ uow: core.uow, clock: core.clock, ids: core.ids })(setter, DECLARATION));
    core.state.events.length = 0;

    const refused = await setNetworkRules(caller(), { rules: [aRule()] });

    expect(refusalOf(refused)).toEqual({ kind: 'NOT_THE_NETWORK_PLUGIN', message: "Only the fleet's networking plugin does this (decision 0035)" });
    expect(core.state.networkSettings).toEqual([expect.objectContaining({ rules: null, version: 1 })]);
    expect(core.state.events).toEqual([]);
  });
});
