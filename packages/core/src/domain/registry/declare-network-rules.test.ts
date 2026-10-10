import { ANY_LABEL_VALUE, DECLARED_NETWORK_RULES_MAX, SAME_LABEL_VALUE, type FleetId, type LabelId, type LabelValueId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { createDeclareNetworkRules } from './declare-network-rules.js';
import type { NetworkRule } from './network-settings.js';

let core: InMemoryCore;
let fleetId: FleetId;
let squadrons: Caller;
let trierarchPlugin: Caller;
let squadronId: LabelId;
let alpha: LabelValueId;
let trierarchId: LabelId;
let declareNetworkRules: ReturnType<typeof createDeclareNetworkRules>;

/** Every ship of a squadron reaches the ships of its own squadron. */
function sameSquadron(): NetworkRule {
  return { from: [{ labelId: squadronId, value: SAME_LABEL_VALUE }], to: [{ labelId: squadronId, value: SAME_LABEL_VALUE }] };
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-10T20:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  const argo = operatorCaller(fleet);
  const registry = registryUseCases(core);
  squadrons = await shipWithScopes({ registry, argo }, { name: 'squadrons', type: 'squadrons', scopes: ['labels:define', 'labels:assign'] });
  trierarchPlugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['labels:define', 'labels:assign'] });
  ({ labelId: squadronId } = unwrap(await registry.defineLabel(squadrons, { key: 'squadron', values: ['alpha', 'beta'] })));
  alpha = valueIdOf(core, { key: 'squadron', value: 'alpha' });
  ({ labelId: trierarchId } = unwrap(await registry.defineLabel(trierarchPlugin, { key: 'trierarch', values: ['agent-host-1'] })));
  declareNetworkRules = createDeclareNetworkRules({ uow: core.uow, clock: core.clock, ids: core.ids });
  core.state.events.length = 0;
});

describe('declaring network rules', () => {
  it("keeps the caller's rules on the labels it owns: an exact value, any value and the same value", async () => {
    const rules = [sameSquadron(), { from: [alpha], to: [{ labelId: squadronId, value: ANY_LABEL_VALUE }] }];

    expect(unwrap(await declareNetworkRules(squadrons, { rules }))).toEqual({ rules: 2 });
    expect(core.state.declaredNetworkRules).toEqual([{ fleetId, shipId: squadrons.shipId, rules }]);
  });

  it('replaces what the ship declared before, keeping what other ships declared', async () => {
    const trierarchRules = [{ from: [{ labelId: trierarchId, value: ANY_LABEL_VALUE }], to: [{ labelId: trierarchId, value: ANY_LABEL_VALUE }] }];
    unwrap(await declareNetworkRules(trierarchPlugin, { rules: trierarchRules }));
    unwrap(await declareNetworkRules(squadrons, { rules: [sameSquadron(), sameSquadron()] }));

    unwrap(await declareNetworkRules(squadrons, { rules: [sameSquadron()] }));

    await expect(core.declaredNetworkRules.list(fleetId)).resolves.toEqual([
      { fleetId, shipId: squadrons.shipId, rules: [sameSquadron()] },
      { fleetId, shipId: trierarchPlugin.shipId, rules: trierarchRules },
    ]);
  });

  it('withdraws them with an empty list', async () => {
    unwrap(await declareNetworkRules(squadrons, { rules: [sameSquadron()] }));

    expect(unwrap(await declareNetworkRules(squadrons, { rules: [] }))).toEqual({ rules: 0 });
    expect(core.state.declaredNetworkRules).toEqual([]);
  });

  it('writes NetworkRulesDeclared, caused by the ship, naming it, with the number of rules, never the rules', async () => {
    unwrap(await declareNetworkRules(squadrons, { rules: [sameSquadron()] }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'NetworkRulesDeclared',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: squadrons.shipId },
        shipId: squadrons.shipId,
        details: { rules: 1 },
      }),
    ]);
  });

  it('puts nothing in force: the networking plugin adds them when it supplies the list', async () => {
    unwrap(await declareNetworkRules(squadrons, { rules: [sameSquadron()] }));

    expect(core.state.networkSettings).toEqual([]);
  });

  it(`takes ${String(DECLARED_NETWORK_RULES_MAX)} rules, the limit`, async () => {
    const rules = Array.from({ length: DECLARED_NETWORK_RULES_MAX }, sameSquadron);

    expect(unwrap(await declareNetworkRules(squadrons, { rules }))).toEqual({ rules: DECLARED_NETWORK_RULES_MAX });
  });

  it('refuses one rule over the limit, naming the decision, keeping and writing nothing', async () => {
    const rules = Array.from({ length: DECLARED_NETWORK_RULES_MAX + 1 }, sameSquadron);

    expect(refusalOf(await declareNetworkRules(squadrons, { rules }))).toEqual({
      kind: 'INVALID_NETWORK_RULES',
      message: 'A ship declares at most 20 network rules (decision 0037)',
    });
    expect(core.state.declaredNetworkRules).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it('refuses a rule with the same value on one side only, as the fleet refuses it', async () => {
    const rule = { from: [{ labelId: squadronId, value: SAME_LABEL_VALUE }], to: [] };

    expect(refusalOf(await declareNetworkRules(squadrons, { rules: [rule] }))).toEqual({
      kind: 'INVALID_NETWORK_RULES',
      message: `A term of the same value binds its label on both sides: ${squadronId}=# is on one side only (decision 0034)`,
    });
  });

  it('refuses a term on a label another ship owns, naming the label and its owner, keeping and writing nothing', async () => {
    const rule = { from: [{ labelId: squadronId, value: SAME_LABEL_VALUE }], to: [{ labelId: squadronId, value: SAME_LABEL_VALUE }, { labelId: trierarchId, value: ANY_LABEL_VALUE }] };

    expect(refusalOf(await declareNetworkRules(squadrons, { rules: [rule] }))).toEqual({
      kind: 'NOT_THE_LABEL_OWNER',
      message: 'The label trierarch is owned by trierarch-plugin: only its owner declares rules on it (decision 0037)',
    });
    expect(core.state.declaredNetworkRules).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it('refuses an exact value of a label another ship owns', async () => {
    expect(refusalOf(await declareNetworkRules(trierarchPlugin, { rules: [{ from: [alpha], to: [] }] }))).toEqual({
      kind: 'NOT_THE_LABEL_OWNER',
      message: 'The label squadron is owned by squadrons: only its owner declares rules on it (decision 0037)',
    });
  });

  it('refuses a label the fleet does not have, as its owner cannot be checked', async () => {
    const unknown = core.ids('label');

    expect(refusalOf(await declareNetworkRules(squadrons, { rules: [{ from: [{ labelId: unknown, value: ANY_LABEL_VALUE }], to: [] }] }))).toEqual({
      kind: 'LABEL_NOT_FOUND',
      message: `The fleet has no label ${unknown}`,
    });
  });

  it('refuses a label value the fleet does not have', async () => {
    const unknown = core.ids('labelValue');

    expect(refusalOf(await declareNetworkRules(squadrons, { rules: [{ from: [], to: [unknown] }] }))).toEqual({
      kind: 'LABEL_VALUE_NOT_FOUND',
      message: `The fleet has no label value ${unknown}`,
    });
  });
});
