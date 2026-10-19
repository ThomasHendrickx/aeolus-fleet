import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  BUILT_IN_RULES,
  explainReachInputSchema,
  FIXED_BUILT_IN_RULES,
  explainReachOutputSchema,
  NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS,
  NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS,
  NETWORK_RULES_MAX,
  NETWORK_VERBS,
  networkPluginOutputSchema,
  REACH_REFUSALS_READ_MAX,
  reachRefusalsOutputSchema,
  registerNetworkPluginInputSchema,
  setNetworkRulesInputSchema,
  setBuiltInRuleInputSchema,
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

describe('the network verbs (decision 0034)', () => {
  it('are send, read and manage', () => {
    expect(NETWORK_VERBS).toEqual(['send', 'read', 'manage']);
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
  it('takes the whole list of rules, each with its verb from one selector of exact label values to another, leaving the limits to the server', () => {
    const rules = [
      { verb: 'send', from: [newId('labelValue'), newId('labelValue')], to: [newId('labelValue')] },
      { verb: 'read', from: [], to: [] },
      { verb: 'manage', from: [], to: [] },
    ];

    expect(setNetworkRulesInputSchema.parse({ rules })).toEqual({ rules });
  });

  it('refuses none: the rules are a list, and open says all-to-all (decision 0034)', () => {
    expect(setNetworkRulesInputSchema.safeParse({ rules: null }).success).toBe(false);
  });

  it('takes a term that holds a label with any value, and one that holds it with the same value as the other side', () => {
    const labelId = newId('label');
    const rules = [{ verb: 'send', from: [{ labelId, value: '*' }, { labelId, value: '#' }], to: [newId('labelValue'), { labelId, value: '#' }] }];

    expect(setNetworkRulesInputSchema.parse({ rules })).toEqual({ rules });
  });

  it("takes a term of the owner: an owner's ship by its id, any owner, and the same owner as the other side", () => {
    const rules = [{ verb: 'send', from: [{ owner: newId('ship') }, { owner: '*' }, { owner: '#' }], to: [{ owner: '#' }] }];

    expect(setNetworkRulesInputSchema.parse({ rules })).toEqual({ rules });
  });

  it('refuses a term of the owner that is not a ship id, any or the same', () => {
    for (const owner of [newId('labelValue'), 'argo']) {
      expect(setNetworkRulesInputSchema.safeParse({ rules: [{ verb: 'send', from: [{ owner }], to: [] }] }).success).toBe(false);
    }
  });

  it('refuses a term of a label with a value written as text, not an id', () => {
    expect(setNetworkRulesInputSchema.safeParse({ rules: [{ verb: 'send', from: [{ labelId: newId('label'), value: 'shared' }], to: [] }] }).success).toBe(false);
  });

  it('refuses a term of any or the same value without a label id', () => {
    expect(setNetworkRulesInputSchema.safeParse({ rules: [{ verb: 'send', from: [{ labelId: newId('labelValue'), value: '*' }], to: [] }] }).success).toBe(false);
  });

  it('refuses a selector that holds a label id alone, without a value', () => {
    expect(setNetworkRulesInputSchema.safeParse({ rules: [{ verb: 'send', from: [newId('label')], to: [] }] }).success).toBe(false);
  });

  it('refuses a rule without both selectors', () => {
    expect(setNetworkRulesInputSchema.safeParse({ rules: [{ verb: 'send', from: [] }] }).success).toBe(false);
  });

  it('refuses a rule without its verb, or with a verb that is not send, read or manage', () => {
    for (const rule of [{ from: [], to: [] }, { verb: 'force', from: [], to: [] }]) {
      expect(setNetworkRulesInputSchema.safeParse({ rules: [rule] }).success).toBe(false);
    }
  });
});

describe('the built-in rules (decision 0034)', () => {
  it("are argo, the owner, the answer, a connected plugin's reading, the viewer reading, the installation's managing and open, all but the viewer reading and open never off", () => {
    expect([BUILT_IN_RULES, FIXED_BUILT_IN_RULES]).toEqual([
      ['argo', 'owner', 'answer', 'pluginRead', 'viewerRead', 'installation', 'open'],
      ['argo', 'owner', 'answer', 'pluginRead', 'installation'],
    ]);
  });
});

describe('setBuiltInRuleInputSchema', () => {
  it.each(['send', 'read', 'manage'])('takes open for one verb, on or off: %s', (verb) => {
    expect(setBuiltInRuleInputSchema.parse({ rule: 'open', verb, isOn: false })).toEqual({ rule: 'open', verb, isOn: false });
  });

  it.each(['argo', 'owner', 'answer', 'pluginRead', 'viewerRead', 'installation'])('takes every other built-in rule without a verb, the server refusing the fixed ones: %s', (rule) => {
    expect(setBuiltInRuleInputSchema.parse({ rule, isOn: true })).toEqual({ rule, isOn: true });
  });

  it('refuses open without a verb, another rule with one, and a rule that is not built in', () => {
    for (const input of [{ rule: 'open', isOn: false }, { rule: 'viewerRead', verb: 'read', isOn: false }, { rule: 'everyone', isOn: false }]) {
      expect(setBuiltInRuleInputSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe('setNetworkRulesOutputSchema', () => {
  it('answers the version the settings have now', () => {
    expect(setNetworkRulesOutputSchema.parse({ version: 3 })).toEqual({ version: 3 });
  });
});

describe('reachRefusalsOutputSchema', () => {
  it('answers each refusal: who tried to reach whom, both ships with the labels they carried and their owners then, the settings version and when', () => {
    const carried = { labelId: newId('label'), key: 'trust', valueId: newId('labelValue'), value: 'shared' };
    const refusal = {
      id: newId('reachRefusal'),
      at: '2026-10-09T19:00:00.000Z',
      sender: { kind: 'ship', id: newId('ship'), name: 'planner', labels: [carried], owner: { id: newId('ship'), name: 'thomas' } },
      askedBy: null,
      recipient: { kind: 'ship', ship: { id: newId('ship'), name: 'vault', labels: [], owner: null } },
      verb: 'send',
      settingsVersion: 2,
      whilePluginUnavailable: null,
    };

    expect(reachRefusalsOutputSchema.parse([refusal])).toEqual([refusal]);
  });

  it('answers a refused send to a type with the type and each ship of it, with the labels it carried then', () => {
    const refusal = {
      id: newId('reachRefusal'),
      at: '2026-10-09T19:00:00.000Z',
      sender: { kind: 'ship', id: newId('ship'), name: 'planner', labels: [], owner: null },
      askedBy: null,
      recipient: { kind: 'type', type: 'keeper', ships: [{ id: newId('ship'), name: 'vault', labels: [], owner: null }] },
      verb: 'send',
      settingsVersion: 2,
      whilePluginUnavailable: null,
    };

    expect(reachRefusalsOutputSchema.parse([refusal])).toEqual([refusal]);
  });

  it('answers what the plugin declared for while it is unavailable, when it refused because the plugin was not responding', () => {
    const refusal = {
      id: newId('reachRefusal'),
      at: '2026-10-10T08:00:00.000Z',
      sender: { kind: 'ship', id: newId('ship'), name: 'planner', labels: [], owner: null },
      askedBy: null,
      recipient: { kind: 'ship', ship: { id: newId('ship'), name: 'vault', labels: [], owner: null } },
      verb: 'send',
      settingsVersion: 2,
      whilePluginUnavailable: 'block-all',
    };

    expect(reachRefusalsOutputSchema.parse([refusal])).toEqual([refusal]);
  });

  it('refuses a ship without its owner', () => {
    const refusal = {
      id: newId('reachRefusal'),
      at: '2026-10-09T19:00:00.000Z',
      sender: { kind: 'ship', id: newId('ship'), name: 'planner', labels: [] },
      askedBy: null,
      recipient: { kind: 'ship', ship: { id: newId('ship'), name: 'vault', labels: [], owner: null } },
      verb: 'send',
      settingsVersion: 2,
      whilePluginUnavailable: null,
    };

    expect(reachRefusalsOutputSchema.safeParse([refusal]).success).toBe(false);
  });

  it('answers an account refused by reach by its id only, with the group values it carried and its person ship then (decision 0057)', () => {
    const group = { labelId: newId('label'), key: 'group', valueId: newId('labelValue'), value: 'engineering' };
    const refusal = {
      id: newId('reachRefusal'),
      at: '2026-10-19T19:00:00.000Z',
      sender: { kind: 'account', accountId: 'acc-mathilde', labels: [group], personShip: null },
      askedBy: null,
      recipient: { kind: 'ship', ship: { id: newId('ship'), name: 'vault', labels: [], owner: null } },
      verb: 'manage',
      settingsVersion: 2,
      whilePluginUnavailable: null,
    };

    expect(reachRefusalsOutputSchema.parse([refusal])).toEqual([refusal]);
  });

  it('answers the installation refused by reach', () => {
    const refusal = {
      id: newId('reachRefusal'),
      at: '2026-10-19T19:00:00.000Z',
      sender: { kind: 'installation' },
      askedBy: null,
      recipient: { kind: 'ship', ship: { id: newId('ship'), name: 'vault', labels: [], owner: null } },
      verb: 'manage',
      settingsVersion: 2,
      whilePluginUnavailable: null,
    };

    expect(reachRefusalsOutputSchema.parse([refusal])).toEqual([refusal]);
  });

  it('never answers an email for an account, even one handed to it', () => {
    const refusal = {
      id: newId('reachRefusal'),
      at: '2026-10-19T19:00:00.000Z',
      sender: { kind: 'account', accountId: 'acc-mathilde', email: 'mathilde@acme.example', labels: [], personShip: null },
      askedBy: null,
      recipient: { kind: 'ship', ship: { id: newId('ship'), name: 'vault', labels: [], owner: null } },
      verb: 'manage',
      settingsVersion: 2,
      whilePluginUnavailable: null,
    };

    expect(reachRefusalsOutputSchema.parse([refusal])[0]?.sender).not.toHaveProperty('email');
  });

  it('refuses open-all as what refused it: open-all refuses nothing', () => {
    const refusal = {
      id: newId('reachRefusal'),
      at: '2026-10-10T08:00:00.000Z',
      sender: { kind: 'ship', id: newId('ship'), name: 'planner', labels: [], owner: null },
      askedBy: null,
      recipient: { kind: 'ship', ship: { id: newId('ship'), name: 'vault', labels: [], owner: null } },
      verb: 'send',
      settingsVersion: 2,
      whilePluginUnavailable: 'open-all',
    };

    expect(reachRefusalsOutputSchema.safeParse([refusal]).success).toBe(false);
  });
});

describe('explainReachInputSchema', () => {
  it('takes the ship to explain from, and the ship asked about or none for every ship', () => {
    const fromShipId = newId('ship');
    const toShipId = newId('ship');

    expect([explainReachInputSchema.parse({ fromShipId }), explainReachInputSchema.parse({ fromShipId, toShipId })]).toEqual([{ fromShipId }, { fromShipId, toShipId }]);
  });

  it('refuses an id that is not a ship id', () => {
    expect(explainReachInputSchema.safeParse({ fromShipId: newId('fleet') }).success).toBe(false);
  });
});

describe('explainReachOutputSchema', () => {
  it('answers per verb the ships reached, each with the rule that allows it: built in, the plugin\'s by place, or declared by its declarer and place', () => {
    const explained = {
      send: [{ shipId: newId('ship'), rule: { builtIn: 'owner' } }],
      read: [{ shipId: newId('ship'), rule: { plugin: 3 } }],
      manage: [{ shipId: newId('ship'), rule: { declared: newId('ship'), index: 0 } }],
    };

    expect(explainReachOutputSchema.parse(explained)).toEqual(explained);
  });

  it('refuses a rule that is not built in, the plugin\'s or declared', () => {
    expect(explainReachOutputSchema.safeParse({ send: [{ shipId: newId('ship'), rule: { builtIn: 'everyone' } }], read: [], manage: [] }).success).toBe(false);
  });
});

describe('networkPluginOutputSchema (interop I-3)', () => {
  it("answers the plugin's ship and when it registered", () => {
    const plugin = { shipId: newId('ship'), registeredAt: '2026-10-18T16:00:00.000Z' };

    expect(networkPluginOutputSchema.parse(plugin)).toEqual(plugin);
  });

  it('answers none for a fleet without a networking plugin', () => {
    expect(networkPluginOutputSchema.parse(null)).toBeNull();
  });

  it.each([
    ['a label id for the ship', { shipId: newId('label'), registeredAt: '2026-10-18T16:00:00.000Z' }],
    ['a registration date that is not ISO 8601', { shipId: newId('ship'), registeredAt: 'yesterday' }],
    ['no registration date', { shipId: newId('ship') }],
  ])('refuses %s', (_label, candidate) => {
    expect(networkPluginOutputSchema.safeParse(candidate).success).toBe(false);
  });
});
