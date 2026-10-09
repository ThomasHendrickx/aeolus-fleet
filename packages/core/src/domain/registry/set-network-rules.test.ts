import { NETWORK_RULES_MAX, SHIP_LABELS_MAX, type FleetId, type LabelValueId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import type { NetworkRule } from './network-settings.js';
import { createSetNetworkRules } from './set-network-rules.js';

let core: InMemoryCore;
let fleetId: FleetId;
let argo: Caller;
let setter: Caller;
let setNetworkRules: ReturnType<typeof createSetNetworkRules>;

/** A rule between selectors of fresh value ids: no label needs to exist, as an unknown id matches no ship. */
function aRule(from = 1, to = 1): NetworkRule {
  return { from: valueIds(from), to: valueIds(to) };
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
  setNetworkRules = createSetNetworkRules({ uow: core.uow, clock: core.clock, ids: core.ids });
  core.state.events.length = 0;
});

describe('setting the network rules', () => {
  it('keeps the whole list of rules for the fleet at version 1, the first set', async () => {
    const rules = [aRule(2, 1), aRule(0, 0)];

    const set = unwrap(await setNetworkRules(setter, { rules }));

    expect(set).toEqual({ version: 1 });
    expect(core.state.networkSettings).toEqual([{ fleetId, rules, version: 1 }]);
  });

  it('replaces the rules and moves the version on every set', async () => {
    unwrap(await setNetworkRules(setter, { rules: [aRule()] }));
    const rules = [aRule()];

    expect(unwrap(await setNetworkRules(argo, { rules }))).toEqual({ version: 2 });
    expect(core.state.networkSettings).toEqual([{ fleetId, rules, version: 2 }]);
  });

  it('keeps an empty list as rules that allow only the fixed exceptions', async () => {
    unwrap(await setNetworkRules(setter, { rules: [] }));

    expect(core.state.networkSettings).toEqual([{ fleetId, rules: [], version: 1 }]);
  });

  it('clears the rules with none, back to all-to-all, moving the version', async () => {
    unwrap(await setNetworkRules(setter, { rules: [aRule()] }));

    expect(unwrap(await setNetworkRules(setter, { rules: null }))).toEqual({ version: 2 });
    expect(core.state.networkSettings).toEqual([{ fleetId, rules: null, version: 2 }]);
  });

  it('writes NetworkRulesSet, caused by the setting ship, with the version and how many rules', async () => {
    unwrap(await setNetworkRules(setter, { rules: [aRule(), aRule()] }));
    unwrap(await setNetworkRules(setter, { rules: null }));

    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'NetworkRulesSet', occurredAt: core.clock.now(), actor: { kind: 'ship', shipId: setter.shipId }, details: { version: 1, rules: 2 } }),
      expect.objectContaining({ type: 'NetworkRulesSet', occurredAt: core.clock.now(), actor: { kind: 'ship', shipId: setter.shipId }, details: { version: 2, rules: null } }),
    ]);
  });

  it(`takes ${String(NETWORK_RULES_MAX)} rules, the limit`, async () => {
    const rules = Array.from({ length: NETWORK_RULES_MAX }, () => aRule());

    expect(unwrap(await setNetworkRules(setter, { rules }))).toEqual({ version: 1 });
  });

  it('refuses one rule over the limit, naming it and its decision, and stores nothing', async () => {
    const rules = Array.from({ length: NETWORK_RULES_MAX + 1 }, () => aRule());

    const refused = await setNetworkRules(setter, { rules });

    expect(refusalOf(refused)).toEqual({ kind: 'INVALID_NETWORK_RULES', message: 'A fleet holds at most 200 network rules (decision 0034)' });
    expect(core.state.networkSettings).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it(`takes a selector of ${String(SHIP_LABELS_MAX)} label values, as many as a ship carries`, async () => {
    expect(unwrap(await setNetworkRules(setter, { rules: [aRule(SHIP_LABELS_MAX, SHIP_LABELS_MAX)] }))).toEqual({ version: 1 });
  });

  it('refuses a selector of one label value more, naming the limit and its decision', async () => {
    const refused = await setNetworkRules(setter, { rules: [aRule(1, SHIP_LABELS_MAX + 1)] });

    expect(refusalOf(refused)).toEqual({ kind: 'INVALID_NETWORK_RULES', message: 'A selector holds at most 20 label values, as a ship carries no more (decision 0034)' });
    expect(core.state.networkSettings).toEqual([]);
  });

  it('refuses a selector that names a label value twice', async () => {
    const valueId = core.ids('labelValue');

    const refused = await setNetworkRules(setter, { rules: [{ from: [valueId, valueId], to: [] }] });

    expect(refusalOf(refused)).toEqual({ kind: 'INVALID_NETWORK_RULES', message: `A selector names each label value once: ${valueId} twice (decision 0034)` });
    expect(core.state.networkSettings).toEqual([]);
  });

  it("keeps each fleet's rules apart", async () => {
    const other = await hostedFleet(core, 'other@example.com');

    unwrap(await setNetworkRules(setter, { rules: [aRule()] }));
    unwrap(await setNetworkRules({ shipId: other.operatorShipId, fleetId: other.fleetId, kind: 'operator', scopes: argo.scopes }, { rules: null }));

    expect(core.state.networkSettings.map((settings) => [settings.fleetId, settings.version, settings.rules?.length ?? null])).toEqual([
      [fleetId, 1, 1],
      [other.fleetId, 1, null],
    ]);
  });
});
