import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS,
  NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS,
  NETWORK_RULES_MAX,
  REACH_REFUSALS_READ_MAX,
  reachRefusalsOutputSchema,
  registerNetworkPluginInputSchema,
  setNetworkRulesInputSchema,
  setNetworkRulesOutputSchema,
} from './network.js';

const newId = createIdGenerator();

describe('the network limits (decision 0034)', () => {
  it('are 200 rules a fleet, and the latest 100 refusals a read', () => {
    expect([NETWORK_RULES_MAX, REACH_REFUSALS_READ_MAX]).toEqual([200, 100]);
  });
});

describe('the networking plugin limits (decision 0035)', () => {
  it('judge a plugin not responding after a minute at the least and a day at the most', () => {
    expect([NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS, NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS]).toEqual([60, 86_400]);
  });
});

describe('registerNetworkPluginInputSchema', () => {
  it.each(['block-all', 'open-all', 'keep-latest'])('takes what happens while the plugin is unavailable: %s', (whileUnavailable) => {
    expect(registerNetworkPluginInputSchema.parse({ whileUnavailable, notRespondingAfterSeconds: 120 })).toEqual({ whileUnavailable, notRespondingAfterSeconds: 120 });
  });

  it('refuses anything else while the plugin is unavailable', () => {
    expect(registerNetworkPluginInputSchema.safeParse({ whileUnavailable: 'deny', notRespondingAfterSeconds: 120 }).success).toBe(false);
  });

  it('takes the limits of not responding, a minute and a day', () => {
    for (const notRespondingAfterSeconds of [NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS, NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS]) {
      expect(registerNetworkPluginInputSchema.safeParse({ whileUnavailable: 'block-all', notRespondingAfterSeconds }).success).toBe(true);
    }
  });

  it('refuses a second under a minute, a second over a day and part of a second', () => {
    for (const notRespondingAfterSeconds of [NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS - 1, NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS + 1, 90.5]) {
      expect(registerNetworkPluginInputSchema.safeParse({ whileUnavailable: 'block-all', notRespondingAfterSeconds }).success).toBe(false);
    }
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
      whilePluginUnavailable: null,
    };

    expect(reachRefusalsOutputSchema.parse([refusal])).toEqual([refusal]);
  });

  it('answers a refused send to a type with the type and each ship of it, with the labels it carried then', () => {
    const refusal = {
      id: newId('reachRefusal'),
      at: '2026-10-09T19:00:00.000Z',
      sender: { id: newId('ship'), name: 'planner', labels: [] },
      recipient: { kind: 'type', type: 'keeper', ships: [{ id: newId('ship'), name: 'vault', labels: [] }] },
      settingsVersion: 2,
      whilePluginUnavailable: null,
    };

    expect(reachRefusalsOutputSchema.parse([refusal])).toEqual([refusal]);
  });

  it('answers what the plugin declared for while it is unavailable, when it refused because the plugin was not responding', () => {
    const refusal = {
      id: newId('reachRefusal'),
      at: '2026-10-10T08:00:00.000Z',
      sender: { id: newId('ship'), name: 'planner', labels: [] },
      recipient: { kind: 'ship', ship: { id: newId('ship'), name: 'vault', labels: [] } },
      settingsVersion: 2,
      whilePluginUnavailable: 'block-all',
    };

    expect(reachRefusalsOutputSchema.parse([refusal])).toEqual([refusal]);
  });

  it('refuses open-all as what refused it: open-all refuses nothing', () => {
    const refusal = {
      id: newId('reachRefusal'),
      at: '2026-10-10T08:00:00.000Z',
      sender: { id: newId('ship'), name: 'planner', labels: [] },
      recipient: { kind: 'ship', ship: { id: newId('ship'), name: 'vault', labels: [] } },
      settingsVersion: 2,
      whilePluginUnavailable: 'open-all',
    };

    expect(reachRefusalsOutputSchema.safeParse([refusal]).success).toBe(false);
  });
});
