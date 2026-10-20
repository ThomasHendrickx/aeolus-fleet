import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  BUILT_IN_RULES,
  declaredNetworkRulesOutputSchema,
  explainReachInputSchema,
  FIXED_BUILT_IN_RULES,
  explainReachOutputSchema,
  applyNetworkRulesInputSchema,
  builtInRulesOutputSchema,
  NETWORK_RULES_MAX,
  NETWORK_VERBS,
  networkRulesDraftChangesOutputSchema,
  networkRulesOutputSchema,
  networkVersionOutputSchema,
  REACH_REFUSALS_READ_MAX,
  reachRefusalsOutputSchema,
  saveNetworkRulesDraftInputSchema,
  setBuiltInRuleInputSchema,
} from './network.js';

const newId = createIdGenerator();

describe('the network limits (decision 0034)', () => {
  it("are 200 of the fleet's own rules, and the latest 100 refusals a read", () => {
    expect([NETWORK_RULES_MAX, REACH_REFUSALS_READ_MAX]).toEqual([200, 100]);
  });
});

describe('the network verbs (decision 0034)', () => {
  it('are send, read and manage', () => {
    expect(NETWORK_VERBS).toEqual(['send', 'read', 'manage']);
  });
});

describe('saveNetworkRulesDraftInputSchema', () => {
  it('takes the whole list of rules, each with its verb from one selector of exact label values to another, leaving the limits to the server', () => {
    const rules = [
      { verb: 'send', from: [newId('labelValue'), newId('labelValue')], to: [newId('labelValue')] },
      { verb: 'read', from: [], to: [] },
      { verb: 'manage', from: [], to: [] },
    ];

    expect(saveNetworkRulesDraftInputSchema.parse({ rules })).toEqual({ rules });
  });

  it('takes none: no rules applied, open, all-to-all (decision 0034)', () => {
    expect(saveNetworkRulesDraftInputSchema.parse({ rules: null })).toEqual({ rules: null });
  });

  it('refuses a draft without its rules', () => {
    expect(saveNetworkRulesDraftInputSchema.safeParse({}).success).toBe(false);
  });

  it('takes a term that holds a label with any value, and one that holds it with the same value as the other side', () => {
    const labelId = newId('label');
    const rules = [{ verb: 'send', from: [{ labelId, value: '*' }, { labelId, value: '#' }], to: [newId('labelValue'), { labelId, value: '#' }] }];

    expect(saveNetworkRulesDraftInputSchema.parse({ rules })).toEqual({ rules });
  });

  it("takes a term of the owner: an owner's ship by its id, any owner, and the same owner as the other side", () => {
    const rules = [{ verb: 'send', from: [{ owner: newId('ship') }, { owner: '*' }, { owner: '#' }], to: [{ owner: '#' }] }];

    expect(saveNetworkRulesDraftInputSchema.parse({ rules })).toEqual({ rules });
  });

  it('refuses a term of the owner that is not a ship id, any or the same', () => {
    for (const owner of [newId('labelValue'), 'argo']) {
      expect(saveNetworkRulesDraftInputSchema.safeParse({ rules: [{ verb: 'send', from: [{ owner }], to: [] }] }).success).toBe(false);
    }
  });

  it('refuses a term of a label with a value written as text, not an id', () => {
    expect(saveNetworkRulesDraftInputSchema.safeParse({ rules: [{ verb: 'send', from: [{ labelId: newId('label'), value: 'shared' }], to: [] }] }).success).toBe(false);
  });

  it('refuses a term of any or the same value without a label id', () => {
    expect(saveNetworkRulesDraftInputSchema.safeParse({ rules: [{ verb: 'send', from: [{ labelId: newId('labelValue'), value: '*' }], to: [] }] }).success).toBe(false);
  });

  it('refuses a selector that holds a label id alone, without a value', () => {
    expect(saveNetworkRulesDraftInputSchema.safeParse({ rules: [{ verb: 'send', from: [newId('label')], to: [] }] }).success).toBe(false);
  });

  it('refuses a rule without both selectors', () => {
    expect(saveNetworkRulesDraftInputSchema.safeParse({ rules: [{ verb: 'send', from: [] }] }).success).toBe(false);
  });

  it('refuses a rule without its verb, or with a verb that is not send, read or manage', () => {
    for (const rule of [{ from: [], to: [] }, { verb: 'force', from: [], to: [] }]) {
      expect(saveNetworkRulesDraftInputSchema.safeParse({ rules: [rule] }).success).toBe(false);
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
  it.each(['argo', 'owner', 'answer', 'pluginRead', 'viewerRead', 'installation', 'open'])('takes every built-in rule, on or off, the server refusing all but the viewer reading: %s', (rule) => {
    expect(setBuiltInRuleInputSchema.parse({ rule, isOn: true })).toEqual({ rule, isOn: true });
  });

  it('refuses a rule that is not built in', () => {
    expect(setBuiltInRuleInputSchema.safeParse({ rule: 'everyone', isOn: false }).success).toBe(false);
  });
});

describe('builtInRulesOutputSchema', () => {
  it('answers each built-in rule once, open among them, with whether it is on', () => {
    const rules = [
      { rule: 'argo', isOn: true },
      { rule: 'viewerRead', isOn: false },
      { rule: 'open', isOn: true },
    ];

    expect(builtInRulesOutputSchema.parse(rules)).toEqual(rules);
  });
});

describe('networkVersionOutputSchema', () => {
  it('answers the version the settings have now', () => {
    expect(networkVersionOutputSchema.parse({ version: 3 })).toEqual({ version: 3 });
  });
});

describe('applyNetworkRulesInputSchema', () => {
  it('takes the settings version the caller saw the draft against', () => {
    expect(applyNetworkRulesInputSchema.parse({ version: 0 })).toEqual({ version: 0 });
  });

  it('refuses a version under 0 or part of one', () => {
    for (const version of [-1, 1.5]) {
      expect(applyNetworkRulesInputSchema.safeParse({ version }).success).toBe(false);
    }
  });
});

describe('networkRulesOutputSchema', () => {
  const rules = [{ verb: 'send', from: [], to: [] }];

  it('answers the applied rules at their version, and the draft with when it was saved and against which version', () => {
    const read = { applied: { rules, version: 4 }, draft: { rules: null, savedAt: '2026-10-20T08:00:00.000Z', savedAgainstVersion: 4 } };

    expect(networkRulesOutputSchema.parse(read)).toEqual(read);
  });

  it('answers none applied for a new fleet, at version 0, and no draft', () => {
    const read = { applied: { rules: null, version: 0 }, draft: null };

    expect(networkRulesOutputSchema.parse(read)).toEqual(read);
  });
});

describe('networkRulesDraftChangesOutputSchema', () => {
  it('answers per verb the reach the draft gains and loses, each pair of ships with the rule that allows it', () => {
    const changes = {
      send: { gained: [{ fromShipId: newId('ship'), toShipId: newId('ship'), rule: { rule: 0 } }], lost: [] },
      read: { gained: [], lost: [{ fromShipId: newId('ship'), toShipId: newId('ship'), rule: { builtIn: 'open' } }] },
      manage: { gained: [], lost: [] },
    };

    expect(networkRulesDraftChangesOutputSchema.parse(changes)).toEqual(changes);
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
    };

    expect(reachRefusalsOutputSchema.parse([refusal])[0]?.sender).not.toHaveProperty('email');
  });
});

describe('explainReachInputSchema', () => {
  it('takes the ship to explain from, and the ship asked about or none for every ship', () => {
    const fromShipId = newId('ship');
    const toShipId = newId('ship');

    expect([explainReachInputSchema.parse({ fromShipId }), explainReachInputSchema.parse({ fromShipId, toShipId })]).toEqual([{ fromShipId }, { fromShipId, toShipId }]);
  });

  it('takes whether to explain the draft instead of the applied rules', () => {
    const fromShipId = newId('ship');

    expect(explainReachInputSchema.parse({ fromShipId, against: 'draft' })).toEqual({ fromShipId, against: 'draft' });
  });

  it('refuses an id that is not a ship id', () => {
    expect(explainReachInputSchema.safeParse({ fromShipId: newId('fleet') }).success).toBe(false);
  });
});

describe('explainReachOutputSchema', () => {
  it("answers per verb the ships reached, each with the rule that allows it: built in, the fleet's own by place, or declared by its declarer and place", () => {
    const explained = {
      send: [{ shipId: newId('ship'), rule: { builtIn: 'owner' } }],
      read: [{ shipId: newId('ship'), rule: { rule: 3 } }],
      manage: [
        { shipId: newId('ship'), rule: { declared: { kind: 'ship', shipId: newId('ship') }, index: 0 } },
        { shipId: newId('ship'), rule: { declared: { kind: 'installation' }, index: 1 } },
      ],
    };

    expect(explainReachOutputSchema.parse(explained)).toEqual(explained);
  });

  it("refuses a rule that is not built in, the fleet's own or declared", () => {
    expect(explainReachOutputSchema.safeParse({ send: [{ shipId: newId('ship'), rule: { builtIn: 'everyone' } }], read: [], manage: [] }).success).toBe(false);
  });
});

describe('declaredNetworkRulesOutputSchema', () => {
  const rules = [{ verb: 'send', from: [], to: [] }];

  it('answers each declarer, a ship or the installation (decision 0052), with its whole list', () => {
    const declared = [
      { declarer: { kind: 'ship', shipId: newId('ship') }, rules },
      { declarer: { kind: 'installation' }, rules },
    ];

    expect(declaredNetworkRulesOutputSchema.parse(declared)).toEqual(declared);
  });

  it('refuses a declarer that is neither a ship nor the installation', () => {
    expect(declaredNetworkRulesOutputSchema.safeParse([{ declarer: { kind: 'account', accountId: 'acc-mathilde' }, rules }]).success).toBe(false);
  });
});
