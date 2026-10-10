import { ANY_LABEL_VALUE, NETWORK_RULES_MAX, SAME_LABEL_VALUE, SHIP_LABELS_MAX, type LabelId, type LabelValueId, type NetworkRule } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { suppliedFleet } from '../../../test/support/supplied-fleet.js';
import { createSaveRules } from './save-rules.js';

let parts: Awaited<ReturnType<typeof suppliedFleet>>;
let saveRules: ReturnType<typeof createSaveRules>;
let nextValue = 0;

/** A label value id no other call gave. */
function aValue(): LabelValueId {
  nextValue += 1;
  return `lbv_01m3tbfspe96yf1rnr4ank9${String(nextValue).padStart(3, '0')}`;
}

/** A label id no other call gave. */
function aLabel(): LabelId {
  nextValue += 1;
  return `lbl_01m3tbfspe96yf1rnr4ank9${String(nextValue).padStart(3, '0')}`;
}

function aRule(from = 1, to = 1): NetworkRule {
  return { from: Array.from({ length: from }, aValue), to: Array.from({ length: to }, aValue) };
}

beforeEach(async () => {
  parts = await suppliedFleet();
  saveRules = createSaveRules({ networks: parts.networks, supplies: parts.supplies });
});

describe("saving argo's rules", () => {
  it('keeps the whole list and supplies it to the fleet at once', async () => {
    const rules = [aRule(2, 1), aRule(0, 0)];

    await expect(saveRules({ fleetId: FLEET_ID, rules })).resolves.toEqual({ isOk: true, value: { rules, supply: 'supplied' } });
    expect(parts.fleet.state.rules).toEqual(rules);
    await expect(parts.networks.find(FLEET_ID)).resolves.toMatchObject({ rules });
  });

  it('keeps none apart from an empty list: none is all-to-all, an empty list only the fixed exceptions', async () => {
    await saveRules({ fleetId: FLEET_ID, rules: [] });
    expect(parts.fleet.state.rules).toEqual([]);

    await saveRules({ fleetId: FLEET_ID, rules: null });
    expect(parts.fleet.state.rules).toBeNull();
  });

  it('keeps what argo declared for while the plugin is unavailable', async () => {
    await parts.networks.save(FLEET_ID, { rules: null, declaration: { whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 } });

    await saveRules({ fleetId: FLEET_ID, rules: [aRule()] });

    expect(parts.fleet.state.plugin).toEqual({ whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 });
  });

  it('keeps the list while the fleet does not answer, waiting to supply it', async () => {
    parts.fleet.state.isAnswering = false;
    const rules = [aRule()];

    await expect(saveRules({ fleetId: FLEET_ID, rules })).resolves.toEqual({ isOk: true, value: { rules, supply: 'waiting' } });
    await expect(parts.networks.find(FLEET_ID)).resolves.toMatchObject({ rules });
  });

  it(`takes ${String(NETWORK_RULES_MAX)} rules and selectors of ${String(SHIP_LABELS_MAX)} label values, the limits`, async () => {
    const rules = [...Array.from({ length: NETWORK_RULES_MAX - 1 }, () => aRule()), aRule(SHIP_LABELS_MAX, SHIP_LABELS_MAX)];

    await expect(saveRules({ fleetId: FLEET_ID, rules })).resolves.toMatchObject({ isOk: true });
  });

  it.each([
    { label: 'one rule over the limit', rules: () => Array.from({ length: NETWORK_RULES_MAX + 1 }, () => aRule()), message: "A fleet holds at most 200 network rules of argo's (decision 0037)" },
    {
      label: 'a selector of one label value more than a ship carries',
      rules: () => [aRule(1, SHIP_LABELS_MAX + 1)],
      message: 'A selector holds at most 20 terms, as a ship carries no more label values (decision 0034)',
    },
  ])('refuses $label, keeping and supplying nothing', async ({ rules, message }) => {
    await expect(saveRules({ fleetId: FLEET_ID, rules: rules() })).resolves.toEqual({ isOk: false, error: { kind: 'INVALID_NETWORK_RULES', message } });
    await expect(parts.networks.find(FLEET_ID)).resolves.toBeUndefined();
    expect(parts.fleet.state.version).toBe(0);
  });

  it('refuses a selector that names a label value twice', async () => {
    const twice = aValue();

    await expect(saveRules({ fleetId: FLEET_ID, rules: [{ from: [twice, twice], to: [] }] })).resolves.toEqual({
      isOk: false,
      error: { kind: 'INVALID_NETWORK_RULES', message: `A selector holds each term once: ${twice} twice (decision 0034)` },
    });
  });

  it('refuses a selector that names a label with any value twice', async () => {
    const label = aLabel();

    await expect(saveRules({ fleetId: FLEET_ID, rules: [{ from: [], to: [{ labelId: label, value: ANY_LABEL_VALUE }, { labelId: label, value: ANY_LABEL_VALUE }] }] })).resolves.toEqual({
      isOk: false,
      error: { kind: 'INVALID_NETWORK_RULES', message: `A selector holds each term once: ${label}=* twice (decision 0034)` },
    });
  });

  it('keeps a rule that binds a label to the same value on both sides', async () => {
    const label = aLabel();
    const rules = [{ from: [{ labelId: label, value: SAME_LABEL_VALUE }], to: [{ labelId: label, value: SAME_LABEL_VALUE }] }];

    await expect(saveRules({ fleetId: FLEET_ID, rules })).resolves.toMatchObject({ isOk: true });
  });

  it('refuses a rule with the same value on one side only, keeping and supplying nothing', async () => {
    const label = aLabel();

    await expect(saveRules({ fleetId: FLEET_ID, rules: [{ from: [{ labelId: label, value: SAME_LABEL_VALUE }], to: [] }] })).resolves.toEqual({
      isOk: false,
      error: { kind: 'INVALID_NETWORK_RULES', message: `A term of the same value binds its label on both sides: ${label}=# is on one side only (decision 0034)` },
    });
    await expect(parts.networks.find(FLEET_ID)).resolves.toBeUndefined();
    expect(parts.fleet.state.version).toBe(0);
  });
});
