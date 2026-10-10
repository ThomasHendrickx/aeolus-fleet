import { createIdGenerator, type LabelValueId, type ListedLabel, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { labelContextOf } from './labels';
import {
  addRule,
  addTerm,
  draftOf,
  isChanged,
  removeRule,
  removeTerm,
  rulesOf,
  selectorOf,
  setRulesOn,
  supplyNote,
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
  scopes: [], labels: [], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, retiredAt: null,
};

function aLabel(key: string, values: string[]): ListedLabel {
  return { id: newId('label'), key, values: values.map((value) => ({ id: newId('labelValue'), value })), owner: { id: ARGO.id, name: 'argo' } };
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
const CONTEXT = labelContextOf([TEAM, TIER], { ships: [ARGO], isOperator: true });
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
  it('is all-to-all while the plugin supplies no rules', () => {
    expect(draftOf(null, newKey)).toEqual({ kind: 'all-to-all' });
  });

  it('holds each supplied rule, from and to as label value ids', () => {
    const draft = draftOf([{ from: [OPS], to: [SENSITIVE] }], newKey);

    expect(rulesOf(draft)).toEqual([{ from: [OPS], to: [SENSITIVE] }]);
  });

  it('saves all-to-all as no rules, and an empty list as rules that allow only argo and replies', () => {
    expect([rulesOf({ kind: 'all-to-all' }), rulesOf(setRulesOn({ kind: 'all-to-all' }, true))]).toEqual([null, []]);
  });

  it('turns rules off to all-to-all, dropping every rule', () => {
    expect(setRulesOn(draftOf([{ from: [OPS], to: [] }], newKey), false)).toEqual({ kind: 'all-to-all' });
  });

  it('adds a rule from every ship to every ship, the selectors to narrow', () => {
    const draft = addRule(setRulesOn({ kind: 'all-to-all' }, true), { newKey, limits: LIMITS });

    expect(rulesOf(draft)).toEqual([{ from: [], to: [] }]);
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
        { from: [OPS], to: [] },
        { from: [RESEARCH], to: [] },
      ],
      newKey,
    );
    const first = onlyRule(draft);

    expect(rulesOf(removeRule(draft, first.key))).toEqual([{ from: [RESEARCH], to: [] }]);
  });

  it('adds a label value to one side of a rule', () => {
    const draft = draftOf([{ from: [], to: [] }], newKey);

    expect(rulesOf(addTerm(draft, { rule: onlyRule(draft).key, side: 'to', term: SENSITIVE, limits: LIMITS }))).toEqual([{ from: [], to: [SENSITIVE] }]);
  });

  it('adds a value once to a side', () => {
    const draft = draftOf([{ from: [OPS], to: [] }], newKey);

    expect(rulesOf(addTerm(draft, { rule: onlyRule(draft).key, side: 'from', term: OPS, limits: LIMITS }))).toEqual([{ from: [OPS], to: [] }]);
  });

  it('adds values to a side up to the most a ship carries, and no more', () => {
    const draft = draftOf([{ from: [OPS, SENSITIVE], to: [] }], newKey);

    expect(rulesOf(addTerm(draft, { rule: onlyRule(draft).key, side: 'from', term: RESEARCH, limits: LIMITS }))).toEqual([{ from: [OPS, SENSITIVE], to: [] }]);
  });

  it('adds a term of any value and one of the same value of a label to a side, each once', () => {
    const draft = draftOf([{ from: [], to: [] }], newKey);
    const key = onlyRule(draft).key;
    let changed = draft;
    for (const term of [ANY_TEAM, SAME_TEAM, { ...ANY_TEAM }, { ...SAME_TEAM }]) {
      changed = addTerm(changed, { rule: key, side: 'from', term, limits: { ...LIMITS, selectorMax: 4 } });
    }

    expect(rulesOf(changed)).toEqual([{ from: [ANY_TEAM, SAME_TEAM], to: [] }]);
  });

  it('removes a term of any value of a label, keeping the one of the same value', () => {
    const draft = draftOf([{ from: [ANY_TEAM, SAME_TEAM], to: [] }], newKey);

    expect(rulesOf(removeTerm(draft, { rule: onlyRule(draft).key, side: 'from', term: { ...ANY_TEAM } }))).toEqual([{ from: [SAME_TEAM], to: [] }]);
  });

  it('removes a value from one side of a rule', () => {
    const draft = draftOf([{ from: [OPS, SENSITIVE], to: [OPS] }], newKey);

    expect(rulesOf(removeTerm(draft, { rule: onlyRule(draft).key, side: 'from', term: OPS }))).toEqual([{ from: [SENSITIVE], to: [OPS] }]);
  });

  it('keeps each rule its key across changes, for the list to keep its rows', () => {
    const draft = draftOf([{ from: [], to: [] }], newKey);
    const key = onlyRule(draft).key;

    expect(onlyRule(addTerm(draft, { rule: key, side: 'from', term: OPS, limits: LIMITS })).key).toBe(key);
  });

  it('is changed once it differs from the rules the plugin holds, and not when it is the same again', () => {
    const saved = [{ from: [OPS], to: [] }];
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

describe('what a save says', () => {
  it.each([
    ['supplied', 'Saved. The fleet enforces them from now on.'],
    ['waiting', 'Saved. The fleet does not answer yet: the networking plugin supplies them as soon as it does.'],
  ] as const)('says the rules took effect or wait for the fleet when the supply is %s', (supply, note) => {
    expect(supplyNote(supply)).toBe(note);
  });

  it('says nothing more in a race with a disconnect or a switch, which the page shows itself', () => {
    expect([supplyNote('not-connected'), supplyNote('unregistered')]).toEqual(['Saved.', 'Saved.']);
  });
});

