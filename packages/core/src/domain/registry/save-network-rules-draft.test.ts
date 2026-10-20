import { accountIdSchema, NETWORK_RULES_MAX, SAME_LABEL_VALUE, SHIP_LABELS_MAX, type FleetId, type LabelValueId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, hostedFleet, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
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
function aRule(from = 1, to = 1): NetworkRule {
  return { verb: 'send', from: valueIds(from), to: valueIds(to) };
}

function valueIds(count: number): LabelValueId[] {
  return Array.from({ length: count }, () => core.ids('labelValue'));
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

describe('saving the draft of the network rules (decision 0034)', () => {
  it('keeps the whole list as the fleet\'s draft, against the settings version it was saved at, leaving the applied rules as they are', async () => {
    const rules: NetworkRule[] = [aRule(2, 1), { ...aRule(0, 0), verb: 'read' }];

    expect(unwrap(await registry.saveNetworkRulesDraft(networking, { rules }))).toEqual({ savedAgainstVersion: 0 });
    expect(core.state.networkRulesDrafts).toEqual([{ fleetId, rules, savedAt: core.clock.now(), savedAgainstVersion: 0 }]);
    expect(core.state.networkSettings).toEqual([]);
  });

  it('keeps none as a draft of all-to-all', async () => {
    await applyNetworkRules(registry, networking, []);

    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: null }));

    expect(core.state.networkRulesDrafts).toEqual([{ fleetId, rules: null, savedAt: core.clock.now(), savedAgainstVersion: 1 }]);
  });

  it('replaces the draft on every save, one draft a fleet', async () => {
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: [aRule()] }));
    core.clock.advance(60_000);
    const rules = [aRule(), aRule()];

    unwrap(await registry.saveNetworkRulesDraft(argo, { rules }));

    expect(core.state.networkRulesDrafts).toEqual([{ fleetId, rules, savedAt: core.clock.now(), savedAgainstVersion: 0 }]);
  });

  it('writes NetworkRulesDraftSaved, caused by the saver, with how many rules and the version it was saved against', async () => {
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: [aRule(), aRule()] }));
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: null }));

    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'NetworkRulesDraftSaved', occurredAt: core.clock.now(), actor: { kind: 'ship', shipId: networking.shipId }, details: { rules: 2, savedAgainstVersion: 0 } }),
      expect.objectContaining({ type: 'NetworkRulesDraftSaved', occurredAt: core.clock.now(), actor: { kind: 'ship', shipId: networking.shipId }, details: { rules: null, savedAgainstVersion: 0 } }),
    ]);
  });

  it('lets an account holding fleet:network save it, the event naming the account (decision 0053)', async () => {
    const mathilde = accountIdSchema.parse('acc-mathilde');
    const account: AccountCaller = { kind: 'account', accountId: mathilde, fleetId, scopes: ['fleet:network'], groupValues: [], personShipId: null, throughShipId: null };

    unwrap(await registry.saveNetworkRulesDraft(account, { rules: [aRule()] }));

    expect(core.state.events.map(({ actor }) => actor)).toEqual([{ kind: 'account', accountId: mathilde, throughShipId: null }]);
  });

  it(`takes ${String(NETWORK_RULES_MAX)} rules, the limit, whatever the fleet's ships declared (decision 0037)`, async () => {
    core.state.declaredNetworkRules.push({ fleetId, declarer: { kind: 'ship', shipId: networking.shipId }, rules: [aRule()] });
    const rules = Array.from({ length: NETWORK_RULES_MAX }, () => aRule());

    expect(unwrap(await registry.saveNetworkRulesDraft(networking, { rules }))).toEqual({ savedAgainstVersion: 0 });
  });

  it('refuses one rule over the limit, naming it and its decision, and keeps nothing', async () => {
    const rules = Array.from({ length: NETWORK_RULES_MAX + 1 }, () => aRule());

    expect(refusalOf(await registry.saveNetworkRulesDraft(networking, { rules }))).toEqual({
      kind: 'INVALID_NETWORK_RULES',
      message: 'A fleet holds at most 200 network rules of its own, beside the ones its ships declared (decision 0037)',
    });
    expect(core.state.networkRulesDrafts).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it(`takes a selector of ${String(SHIP_LABELS_MAX)} terms and refuses one of more, naming the limit`, async () => {
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: [aRule(SHIP_LABELS_MAX, SHIP_LABELS_MAX)] }));

    expect(refusalOf(await registry.saveNetworkRulesDraft(networking, { rules: [aRule(SHIP_LABELS_MAX + 1, 0)] }))).toEqual({
      kind: 'INVALID_NETWORK_RULES',
      message: 'A selector holds at most 20 terms, as a ship carries no more label values (decision 0034)',
    });
  });

  it('refuses a term of the same value on one side only, keeping the draft before', async () => {
    const before = [aRule()];
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: before }));
    const labelId = core.ids('label');

    const refused = await registry.saveNetworkRulesDraft(networking, { rules: [{ verb: 'send', from: [{ labelId, value: SAME_LABEL_VALUE }], to: [] }] });

    expect(refusalOf(refused).kind).toBe('INVALID_NETWORK_RULES');
    expect(core.state.networkRulesDrafts).toEqual([expect.objectContaining({ rules: before })]);
  });

  it("keeps the caller's fleet's draft only", async () => {
    const other = await hostedFleet(core);
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: [aRule()] }));

    expect(core.state.networkRulesDrafts.map((draft) => draft.fleetId)).toEqual([fleetId]);
    expect(other.fleetId).not.toBe(fleetId);
  });
});
