import type { NetworkRule, SelectorTerm } from '@aeolus-fleet/common';

import { pickedChips, type LabelChip, type LabelContext } from './labels';
import type { SavedRules } from './networking-plugin-schemas';

/**
 * The network rules as argo edits them in the networking plugin's editor
 * (decisions 0034, 0036): all-to-all (no rules), or a list of rules, each
 * letting the ships matching one label selector send to those matching
 * another. An empty list allows only the fixed exceptions, argo and replies.
 * Pure: the draft lives in the editor until Save sends it whole.
 */

/** One rule in the draft, with a key of its own so its row stays put while it changes. */
export interface DraftRule {
  key: string;
  from: readonly SelectorTerm[];
  to: readonly SelectorTerm[];
}

export type NetworkDraft = { kind: 'all-to-all' } | { kind: 'rules'; rules: readonly DraftRule[] };

export type RuleSide = 'from' | 'to';

/** The most rules a fleet holds and the most values one selector holds, as common states them. */
export interface NetworkLimits {
  rulesMax: number;
  selectorMax: number;
}

/** What a save did at the fleet, as the networking plugin answers it. */
export type Supply = SavedRules['supply'];

/** The draft of the rules the plugin holds: none is all-to-all. */
export function draftOf(rules: readonly NetworkRule[] | null, newKey: () => string): NetworkDraft {
  if (rules === null) {
    return { kind: 'all-to-all' };
  }
  return { kind: 'rules', rules: rules.map((rule) => ({ key: newKey(), from: [...rule.from], to: [...rule.to] })) };
}

/** What Save sends: null for all-to-all, else every rule. */
export function rulesOf(draft: NetworkDraft): NetworkRule[] | null {
  return draft.kind === 'all-to-all' ? null : draft.rules.map((rule) => ({ from: [...rule.from], to: [...rule.to] }));
}

/** Rules on starts from an empty list; off is all-to-all and drops every rule. */
export function setRulesOn(draft: NetworkDraft, isOn: boolean): NetworkDraft {
  if (!isOn) {
    return { kind: 'all-to-all' };
  }
  return draft.kind === 'rules' ? draft : { kind: 'rules', rules: [] };
}

/** A new rule from every ship to every ship, for the selectors to narrow; none past the most a fleet holds. */
export function addRule(draft: NetworkDraft, at: { newKey: () => string; limits: NetworkLimits }): NetworkDraft {
  if (draft.kind === 'all-to-all' || draft.rules.length >= at.limits.rulesMax) {
    return draft;
  }
  return { kind: 'rules', rules: [...draft.rules, { key: at.newKey(), from: [], to: [] }] };
}

export function removeRule(draft: NetworkDraft, key: string): NetworkDraft {
  return draft.kind === 'all-to-all' ? draft : { kind: 'rules', rules: draft.rules.filter((rule) => rule.key !== key) };
}

function changeRule(draft: NetworkDraft, at: { key: string; change: (rule: DraftRule) => DraftRule }): NetworkDraft {
  return draft.kind === 'all-to-all' ? draft : { kind: 'rules', rules: draft.rules.map((rule) => (rule.key === at.key ? at.change(rule) : rule)) };
}

/** Adds a term to one side of a rule: once, and none past the most a selector holds. */
export function addTerm(draft: NetworkDraft, at: { rule: string; side: RuleSide; term: SelectorTerm; limits: NetworkLimits }): NetworkDraft {
  return changeRule(draft, {
    key: at.rule,
    change: (rule) => {
      const terms = rule[at.side];
      if (terms.some((term) => isSameTerm(term, at.term)) || terms.length >= at.limits.selectorMax) {
        return rule;
      }
      return { ...rule, [at.side]: [...terms, at.term] };
    },
  });
}

export function removeTerm(draft: NetworkDraft, at: { rule: string; side: RuleSide; term: SelectorTerm }): NetworkDraft {
  return changeRule(draft, { key: at.rule, change: (rule) => ({ ...rule, [at.side]: rule[at.side].filter((term) => !isSameTerm(term, at.term)) }) });
}

/** One term is another: the same value id, or the same label with the same any or same-value mark. */
function isSameTerm(one: SelectorTerm, other: SelectorTerm): boolean {
  return termKeyOf(one) === termKeyOf(other);
}

/** A term as one text, unique per term: a value id, or `<label id>=*` and `<label id>=#`, for comparing and for a list's keys. */
export function termKeyOf(term: SelectorTerm): string {
  return typeof term === 'string' ? term : `${term.labelId}=${term.value}`;
}

/** Whether the draft differs from the rules the plugin holds; all-to-all is never an empty list. */
export function isChanged(draft: NetworkDraft, saved: readonly NetworkRule[] | null): boolean {
  return JSON.stringify(rulesOf(draft)) !== JSON.stringify(saved);
}

/** One term of a rule's side as a chip: `key=value`, `key=*` or `key=#`, with its label's owner, and the term it shows. */
export interface TermChip extends Pick<LabelChip, 'labelId' | 'key' | 'value' | 'mark' | 'ownerName'> {
  term: SelectorTerm;
}

/**
 * One side of a rule as the editor shows it: a chip per term, an exact value
 * as `key=value`, any value as `key=*` and the same value as the other side's
 * as `key=#`; and the terms whose value or label the fleet no longer has,
 * which match no ship (decision 0034).
 */
export function selectorOf(terms: readonly SelectorTerm[], context: LabelContext): { chips: TermChip[]; unknown: SelectorTerm[] } {
  const chips: TermChip[] = [];
  const unknown: SelectorTerm[] = [];
  for (const term of terms) {
    const chip = chipOf(term, context);
    if (chip === undefined) {
      unknown.push(term);
    } else {
      chips.push(chip);
    }
  }
  return { chips, unknown };
}

function chipOf(term: SelectorTerm, context: LabelContext): TermChip | undefined {
  if (typeof term === 'string') {
    const [chip] = pickedChips([term], context);
    return chip === undefined ? undefined : { labelId: chip.labelId, key: chip.key, value: chip.value, mark: chip.mark, ownerName: chip.ownerName, term };
  }
  const label = context.labels.find((each) => each.id === term.labelId);
  if (label === undefined) {
    return undefined;
  }
  const owner = context.ownerOf.get(label.id);
  return { labelId: label.id, key: label.key, value: term.value, mark: owner?.mark ?? 'ship', ownerName: owner?.name ?? label.owner.name, term };
}

/**
 * The labels a side holds a term of the same value of that the other side
 * does not: the fleet refuses such a rule, as `#` matches the value the ship
 * on the other side carries (decision 0034).
 */
function sameValueAlone(rule: DraftRule, side: RuleSide): SelectorTerm[] {
  const other = rule[side === 'from' ? 'to' : 'from'];
  return rule[side].filter((term) => typeof term !== 'string' && term.value === '#' && !other.some((each) => isSameTerm(each, term)));
}

/** What the editor says under a side that holds a term of the same value the other side does not; undefined when none. */
export function sameValueProblemOf(rule: DraftRule, at: { side: RuleSide; context: LabelContext }): string | undefined {
  const [term] = sameValueAlone(rule, at.side);
  if (term === undefined || typeof term === 'string') {
    return undefined;
  }
  const key = at.context.labels.find((label) => label.id === term.labelId)?.key ?? term.labelId;
  return `${key}=# needs ${key}=# on the other side: # matches the same value there.`;
}

/** Whether a rule of the draft holds a term of the same value on one side only: the fleet refuses it, so the draft does not save. */
export function hasSameValueOnOneSide(draft: NetworkDraft): boolean {
  return draft.kind === 'rules' && draft.rules.some((rule) => sameValueAlone(rule, 'from').length + sameValueAlone(rule, 'to').length > 0);
}

/** What a save says of its supply. A race with a disconnect or a switch says only Saved: the page shows that state itself. */
export function supplyNote(supply: Supply): string {
  switch (supply) {
    case 'supplied':
      return 'Saved. The fleet enforces them from now on.';
    case 'waiting':
      return 'Saved. The fleet does not answer yet: the networking plugin supplies them as soon as it does.';
    case 'not-connected':
    case 'unregistered':
      return 'Saved.';
  }
}
