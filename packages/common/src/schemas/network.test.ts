import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { NETWORK_RULES_MAX, REACH_REFUSALS_READ_MAX, reachRefusalsOutputSchema, setNetworkRulesInputSchema, setNetworkRulesOutputSchema } from './network.js';

const newId = createIdGenerator();

describe('the network limits (decision 0033)', () => {
  it('are 200 rules a fleet, and the latest 100 refusals a read', () => {
    expect([NETWORK_RULES_MAX, REACH_REFUSALS_READ_MAX]).toEqual([200, 100]);
  });
});

describe('setNetworkRulesInputSchema', () => {
  it('takes the whole list of rules, each from one label selector to another, leaving the limits to the server', () => {
    const rules = [
      { from: [newId('labelValue'), newId('labelValue')], to: [newId('labelValue')] },
      { from: [], to: [] },
    ];

    expect(setNetworkRulesInputSchema.parse({ rules })).toEqual({ rules });
  });

  it('takes none for no rules: all-to-all', () => {
    expect(setNetworkRulesInputSchema.parse({ rules: null })).toEqual({ rules: null });
  });

  it('refuses a selector that holds anything but label value ids', () => {
    expect(setNetworkRulesInputSchema.safeParse({ rules: [{ from: [newId('label')], to: [] }] }).success).toBe(false);
  });

  it('refuses a rule without both selectors', () => {
    expect(setNetworkRulesInputSchema.safeParse({ rules: [{ from: [] }] }).success).toBe(false);
  });
});

describe('setNetworkRulesOutputSchema', () => {
  it('answers the version the settings have now', () => {
    expect(setNetworkRulesOutputSchema.parse({ version: 3 })).toEqual({ version: 3 });
  });
});

describe('reachRefusalsOutputSchema', () => {
  it('answers each refusal: who tried to reach whom, both ships with the labels they carried then, the settings version and when', () => {
    const carried = { labelId: newId('label'), key: 'trust', valueId: newId('labelValue'), value: 'shared' };
    const refusal = {
      id: newId('reachRefusal'),
      at: '2026-10-09T19:00:00.000Z',
      sender: { id: newId('ship'), name: 'planner', labels: [carried] },
      recipient: { kind: 'ship', ship: { id: newId('ship'), name: 'vault', labels: [] } },
      settingsVersion: 2,
    };

    expect(reachRefusalsOutputSchema.parse([refusal])).toEqual([refusal]);
  });
});
