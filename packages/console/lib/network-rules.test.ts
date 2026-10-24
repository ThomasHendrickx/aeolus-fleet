import { createIdGenerator, type LabelValueId, type ListedLabel, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { countedIn } from './fixtures/labels.fixtures';
import { labelContextOf } from './labels';
import {
  addRule,
  addTerm,
  draftOf,
  isChanged,
  ownerChoicesOf,
  removeRule,
  removeTerm,
  rulesOf,
  selectorOf,
  hasSameValueOnOneSide,
  sameValueProblemOf,
  setRulesOn,
  setVerb,
  type NetworkDraft,
} from './network-rules';

const newId = createIdGenerator();
let keys = 0;
const newKey = () => {
  keys += 1;
  return `rule-${String(keys)}`;
};

const ARGO: ListedShip = {
  id: newId('ship'), name: 'argo', type: 'operator', kind: 'operator', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null,
  scopes: [], labels: [], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, retiredAt: null, ownerShipId: null,
};

function aLabel(key: string, values: string[]): ListedLabel {
  return { id: newId('label'), key, values: values.map((value) => ({ id: newId('labelValue'), value })), owner: { kind: 'ship', id: ARGO.id, name: 'argo' } };
}

function valueOf(label: ListedLabel, index: number): LabelValueId {
  const value = label.values[index];
  if (value === undefined) {
    throw new RangeError(`${label.key} has no value ${String(index)}`);
  }
  return value.id;
}

const TEAM = aLabel('team', ['ops', 'research']);
const TIER = aLabel('tier', ['sensitive']);
const ALICE: ListedShip = { ...ARGO, id: newId('ship'), name: 'alice', type: 'person', kind: 'person' };
const PLANNER: ListedShip = { ...ARGO, id: newId('ship'), name: 'planner', type: 'planner', kind: 'agent' };
const CONTEXT = labelContextOf(countedIn([TEAM, TIER], []), { ships: [ARGO, ALICE, PLANNER], isOperator: true });
const OPS = valueOf(TEAM, 0);
const RESEARCH = valueOf(TEAM, 1);
const SENSITIVE = valueOf(TIER, 0);
const ANY_TEAM = { labelId: TEAM.id, value: '*' } as const;
const SAME_TEAM = { labelId: TEAM.id, value: '#' } as const;
const LIMITS = { rulesMax: 3, selectorMax: 2 };

function onlyRule(draft: NetworkDraft) {
  if (draft.kind !== 'rules' || draft.rules[0] === undefined) {
    throw new Error('the draft holds no rule');
  }
  return draft.rules[0];
}

describe('the network draft argo edits (decision 0034)', () => {
  it('is all-to-all while the fleet holds no rules', () => {
    expect(draftOf(null, newKey)).toEqual({ kind: 'all-to-all' });
  });

  it('holds each supplied rule, from and to as label value ids', () => {
    const draft = draftOf([{ verb: 'send', from: [OPS], to: [SENSITIVE] }], newKey);

    expect(rulesOf(draft)).toEqual([{ verb: 'send', from: [OPS], to: [SENSITIVE] }]);
  });

  it('saves all-to-all as no rules, and an empty list as rules that allow only argo and replies', () => {
    expect([rulesOf({ kind: 'all-to-all' }), rulesOf(setRulesOn({ kind: 'all-to-all' }, true))]).toEqual([null, []]);
  });

  it('turns rules off to all-to-all, dropping every rule', () => {
    expect(setRulesOn(draftOf([{ verb: 'send', from: [OPS], to: [] }], newKey), false)).toEqual({ kind: 'all-to-all' });
  });

  it('adds a rule from every ship to every ship, the selectors to narrow', () => {
    const draft = addRule(setRulesOn({ kind: 'all-to-all' }, true), { newKey, limits: LIMITS });

    expect(rulesOf(draft)).toEqual([{ verb: 'send', from: [], to: [] }]);
  });

  it('adds rules up to the most a fleet holds, and no more', () => {
    let draft = setRulesOn({ kind: 'all-to-all' }, true);
    for (let added = 0; added < LIMITS.rulesMax + 1; added += 1) {
      draft = addRule(draft, { newKey, limits: LIMITS });
    }

    expect(rulesOf(draft)).toHaveLength(LIMITS.rulesMax);
  });

  it('removes one rule, keeping the others', () => {
    const draft = draftOf(
      [
        { verb: 'send', from: [OPS], to: [] },
        { verb: 'send', from: [RESEARCH], to: [] },
      ],
      newKey,
    );
    const first = onlyRule(draft);

    expect(rulesOf(removeRule(draft, first.key))).toEqual([{ verb: 'send', from: [RESEARCH], to: [] }]);
  });

  it('adds a label value to one side of a rule', () => {
    const draft = draftOf([{ verb: 'send', from: [], to: [] }], newKey);

    expect(rulesOf(addTerm(draft, { rule: onlyRule(draft).key, side: 'to', term: SENSITIVE, limits: LIMITS }))).toEqual([{ verb: 'send', from: [], to: [SENSITIVE] }]);
  });

  it('adds a value once to a side', () => {
    const draft = draftOf([{ verb: 'send', from: [OPS], to: [] }], newKey);

    expect(rulesOf(addTerm(draft, { rule: onlyRule(draft).key, side: 'from', term: OPS, limits: LIMITS }))).toEqual([{ verb: 'send', from: [OPS], to: [] }]);
  });

  it('adds values to a side up to the most a ship carries, and no more', () => {
    const draft = draftOf([{ verb: 'send', from: [OPS, SENSITIVE], to: [] }], newKey);

    expect(rulesOf(addTerm(draft, { rule: onlyRule(draft).key, side: 'from', term: RESEARCH, limits: LIMITS }))).toEqual([{ verb: 'send', from: [OPS, SENSITIVE], to: [] }]);
  });

  it('adds a term of any value and one of the same value of a label to a side, each once', () => {
    const draft = draftOf([{ verb: 'send', from: [], to: [] }], newKey);
    const key = onlyRule(draft).key;
    let changed = draft;
    for (const term of [ANY_TEAM, SAME_TEAM, { ...ANY_TEAM }, { ...SAME_TEAM }]) {
      changed = addTerm(changed, { rule: key, side: 'from', term, limits: { ...LIMITS, selectorMax: 4 } });
    }

    expect(rulesOf(changed)).toEqual([{ verb: 'send', from: [ANY_TEAM, SAME_TEAM], to: [] }]);
  });

  it('removes a term of any value of a label, keeping the one of the same value', () => {
    const draft = draftOf([{ verb: 'send', from: [ANY_TEAM, SAME_TEAM], to: [] }], newKey);

    expect(rulesOf(removeTerm(draft, { rule: onlyRule(draft).key, side: 'from', term: { ...ANY_TEAM } }))).toEqual([{ verb: 'send', from: [SAME_TEAM], to: [] }]);
  });

  it('removes a value from one side of a rule', () => {
    const draft = draftOf([{ verb: 'send', from: [OPS, SENSITIVE], to: [OPS] }], newKey);

    expect(rulesOf(removeTerm(draft, { rule: onlyRule(draft).key, side: 'from', term: OPS }))).toEqual([{ verb: 'send', from: [SENSITIVE], to: [OPS] }]);
  });

  it('keeps each rule its key across changes, for the list to keep its rows', () => {
    const draft = draftOf([{ verb: 'send', from: [], to: [] }], newKey);
    const key = onlyRule(draft).key;

    expect(onlyRule(addTerm(draft, { rule: key, side: 'from', term: OPS, limits: LIMITS })).key).toBe(key);
  });

  it('is changed once it differs from the rules the fleet holds, and not when it is the same again', () => {
    const saved = [{ verb: 'send' as const, from: [OPS], to: [] }];
    const draft = draftOf(saved, newKey);
    const changed = addTerm(draft, { rule: onlyRule(draft).key, side: 'to', term: SENSITIVE, limits: LIMITS });

    expect([isChanged(draft, saved), isChanged(changed, saved), isChanged(removeTerm(changed, { rule: onlyRule(draft).key, side: 'to', term: SENSITIVE }), saved)]).toEqual([false, true, false]);
  });

  it('tells all-to-all from an empty list when comparing', () => {
    expect([isChanged({ kind: 'all-to-all' }, []), isChanged(setRulesOn({ kind: 'all-to-all' }, true), null)]).toEqual([true, true]);
  });
});

describe('a selector as the editor shows it', () => {
  it('shows each value as a chip of key=value', () => {
    expect(selectorOf([OPS, SENSITIVE], CONTEXT).chips.map((chip) => `${chip.key}=${chip.value}`)).toEqual(['team=ops', 'tier=sensitive']);
  });

  it('shows a term of any value as key=* and one of the same value as key=#, each by its term', () => {
    expect(selectorOf([OPS, ANY_TEAM, SAME_TEAM], CONTEXT).chips.map((chip) => [`${chip.key}=${chip.value}`, chip.term])).toEqual([
      ['team=ops', OPS],
      ['team=*', ANY_TEAM],
      ['team=#', SAME_TEAM],
    ]);
  });

  it('counts a term of any or the same value of a label the fleet no longer has', () => {
    const gone = newId('label');

    expect(selectorOf([{ labelId: gone, value: '*' }, ANY_TEAM, { labelId: gone, value: '#' }], CONTEXT).unknown).toEqual([
      { labelId: gone, value: '*' },
      { labelId: gone, value: '#' },
    ]);
  });

  it('counts values the fleet no longer has: that side matches no ship (decision 0034)', () => {
    const gone = newId('labelValue');

    expect(selectorOf([OPS, gone], CONTEXT)).toMatchObject({ unknown: [gone] });
  });
});

describe("a rule's verb (decision 0034)", () => {
  it('starts a new rule as a send rule', () => {
    expect(onlyRule(addRule(setRulesOn({ kind: 'all-to-all' }, true), { newKey, limits: LIMITS })).verb).toBe('send');
  });

  it('turns a rule to read or manage, keeping its selectors, and saves it so', () => {
    const draft = draftOf([{ verb: 'send', from: [OPS], to: [SENSITIVE] }], newKey);

    const changed = setVerb(draft, { rule: onlyRule(draft).key, verb: 'manage' });

    expect(rulesOf(changed)).toEqual([{ verb: 'manage', from: [OPS], to: [SENSITIVE] }]);
  });
});

describe('a term of the owner (decision 0045)', () => {
  const SAME_OWNER = { owner: '#' } as const;

  it('offers argo and every person ship as an owner, and no other ship', () => {
    expect(ownerChoicesOf(CONTEXT)).toEqual([
      { shipId: ARGO.id, name: 'argo' },
      { shipId: ALICE.id, name: 'alice' },
    ]);
  });

  it('leaves a retired person ship out of the owners offered', () => {
    const retired = { ...ALICE, status: 'retired' as const };

    expect(ownerChoicesOf(labelContextOf([], { ships: [ARGO, retired], isOperator: true }))).toEqual([{ shipId: ARGO.id, name: 'argo' }]);
  });

  it('shows an owner by its ship as owner=name, any owner as owner=* and the same owner as owner=#, apart from the label chips', () => {
    expect(selectorOf([OPS, { owner: ALICE.id }, { owner: '*' }, SAME_OWNER], CONTEXT)).toMatchObject({
      chips: [{ term: OPS }],
      owners: [
        { term: { owner: ALICE.id }, text: 'owner=alice' },
        { term: { owner: '*' }, text: 'owner=*' },
        { term: SAME_OWNER, text: 'owner=#' },
      ],
      unknown: [],
    });
  });

  it('counts an owner ship the fleet does not have: that side matches no ship', () => {
    const gone = newId('ship');

    expect(selectorOf([{ owner: gone }], CONTEXT)).toMatchObject({ owners: [], unknown: [{ owner: gone }] });
  });

  it('adds an owner term to a side once', () => {
    const draft = draftOf([{ verb: 'read', from: [], to: [] }], newKey);
    const at = { rule: onlyRule(draft).key, side: 'from' as const, term: { owner: ALICE.id }, limits: LIMITS };

    expect(rulesOf(addTerm(addTerm(draft, at), at))).toEqual([{ verb: 'read', from: [{ owner: ALICE.id }], to: [] }]);
  });

  it('says the same owner needs the same owner on the other side, and keeps the draft from being saved', () => {
    const draft = draftOf([{ verb: 'read', from: [SAME_OWNER], to: [OPS] }], newKey);

    expect(sameValueProblemOf(onlyRule(draft), { side: 'from', context: CONTEXT })).toBe('owner=# needs owner=# on the other side: # matches the same owner there.');
    expect(hasSameValueOnOneSide(draft)).toBe(true);
    expect(hasSameValueOnOneSide(draftOf([{ verb: 'read', from: [SAME_OWNER], to: [SAME_OWNER] }], newKey))).toBe(false);
  });
});

describe('a term of the same value on one side only (decision 0034)', () => {
  const SAME_TIER = { labelId: TIER.id, value: '#' } as const;

  it('says which term of the same value a side holds that the other side does not', () => {
    const rule = onlyRule(draftOf([{ verb: 'send', from: [SAME_TEAM, SAME_TIER], to: [SAME_TEAM] }], newKey));

    expect([sameValueProblemOf(rule, { side: 'from', context: CONTEXT }), sameValueProblemOf(rule, { side: 'to', context: CONTEXT })]).toEqual([
      'tier=# needs tier=# on the other side: # matches the same value there.',
      undefined,
    ]);
  });

  it('keeps a draft from being saved while a rule holds one', () => {
    expect([
      hasSameValueOnOneSide(draftOf([{ verb: 'send', from: [SAME_TEAM], to: [OPS] }], newKey)),
      hasSameValueOnOneSide(draftOf([{ verb: 'send', from: [SAME_TEAM], to: [SAME_TEAM] }], newKey)),
      hasSameValueOnOneSide({ kind: 'all-to-all' }),
    ]).toEqual([true, false, false]);
  });
});
