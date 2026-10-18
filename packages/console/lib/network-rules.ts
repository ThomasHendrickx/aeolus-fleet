import { isOwnerTerm, type LabelTerm, type NetworkRule, type NetworkVerb, type OwnerTerm, type SelectorTerm, type ShipId } from '@aeolus-fleet/common';

import { pickedChips, type LabelChip, type LabelContext } from './labels';
import type { SavedRules } from './networking-plugin-schemas';

/**
 * The network rules as argo edits them in the networking plugin's editor
 * (decisions 0034, 0036): all-to-all (no rules), or a list of rules, each
 * letting the ships matching one selector of label and owner terms do its
 * verb, send, read or manage, to those matching another; a rule added here
 * starts as a send rule. An empty list allows only the built-in rules.
 * Pure: the draft lives in the editor until Save sends it whole.
 */

/** What each verb lets the ships on a rule's left do to those on its right, as the editor and the declared rules say it (decision 0034). */
export const VERB_WORDS: Readonly<Record<NetworkVerb, string>> = { send: 'May send to', read: 'May read', manage: 'May manage' };

/** One rule in the draft, with a key of its own so its row stays put while it changes. */
export interface DraftRule {
  key: string;
  verb: NetworkVerb;
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
  return { kind: 'rules', rules: rules.map((rule) => ({ key: newKey(), verb: rule.verb, from: [...rule.from], to: [...rule.to] })) };
}

/** What Save sends: null for all-to-all, else every rule. */
export function rulesOf(draft: NetworkDraft): NetworkRule[] | null {
  return draft.kind === 'all-to-all' ? null : draft.rules.map((rule) => ({ verb: rule.verb, from: [...rule.from], to: [...rule.to] }));
}

/** Rules on starts from an empty list; off is all-to-all and drops every rule. */
export function setRulesOn(draft: NetworkDraft, isOn: boolean): NetworkDraft {
  if (!isOn) {
    return { kind: 'all-to-all' };
  }
  return draft.kind === 'rules' ? draft : { kind: 'rules', rules: [] };
}

/** A new send rule from every ship to every ship, for the selectors to narrow; none past the most a fleet holds. */
export function addRule(draft: NetworkDraft, at: { newKey: () => string; limits: NetworkLimits }): NetworkDraft {
  if (draft.kind === 'all-to-all' || draft.rules.length >= at.limits.rulesMax) {
    return draft;
  }
  return { kind: 'rules', rules: [...draft.rules, { key: at.newKey(), verb: 'send', from: [], to: [] }] };
}

/** Turns a rule to another verb, keeping its selectors. */
export function setVerb(draft: NetworkDraft, at: { rule: string; verb: NetworkVerb }): NetworkDraft {
  return changeRule(draft, { key: at.rule, change: (rule) => ({ ...rule, verb: at.verb }) });
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

/** A term as one text, unique per term: a value id, `<label id>=*` and `<label id>=#`, or `owner=<value>`, for comparing and for a list's keys. */
export function termKeyOf(term: SelectorTerm): string {
  if (typeof term === 'string') {
    return term;
  }
  return isOwnerTerm(term) ? `owner=${term.owner}` : `${term.labelId}=${term.value}`;
}

/** Whether the draft differs from the rules the plugin holds; all-to-all is never an empty list. */
export function isChanged(draft: NetworkDraft, saved: readonly NetworkRule[] | null): boolean {
  return JSON.stringify(rulesOf(draft)) !== JSON.stringify(saved);
}

/** What a term of any value and one of the same value match, as the picker offers them and their chips say. */
export const TERM_MEANINGS: Readonly<Record<Exclude<LabelTerm, string>['value'], string>> = { '*': 'Any value', '#': 'The same value as the other side' };

/** One term of a rule's side as a chip: `key=value`, `key=*` or `key=#`, with its label's owner, and the term it shows. */
export interface TermChip extends Pick<LabelChip, 'labelId' | 'key' | 'value' | 'mark' | 'ownerName'> {
  term: LabelTerm;
}

/** What an owner term of any owner and one of the same owner match, as the picker offers them and their chips say. */
export const OWNER_TERM_MEANINGS: Readonly<Record<'*' | '#', string>> = { '*': 'Any owner', '#': 'The same owner as the other side' };

/** One owner term as a chip: `owner=<name>`, `owner=*` or `owner=#`, and the term it shows. */
export interface OwnerChip {
  term: OwnerTerm;
  text: string;
}

/** A ship that may own others (decision 0045): argo or a person's ship. */
export interface OwnerChoice {
  shipId: ShipId;
  name: string;
}

/** The owners an owner term may name: argo and every person ship that is not retired, in the fleet's order. */
export function ownerChoicesOf(context: LabelContext): OwnerChoice[] {
  return context.ships
    .filter((ship) => (ship.kind === 'operator' || ship.kind === 'person') && ship.status !== 'retired')
    .map((ship) => ({ shipId: ship.id, name: ship.name }));
}

/**
 * One side of a rule as the editor shows it: a chip per label term, an exact
 * value as `key=value`, any value as `key=*` and the same value as the other
 * side's as `key=#`; a chip per owner term, `owner=<name>`, `owner=*` or
 * `owner=#`; and the terms whose value, label or owner ship the fleet no
 * longer has, which match no ship (decision 0034).
 */
export function selectorOf(terms: readonly SelectorTerm[], context: LabelContext): { chips: TermChip[]; owners: OwnerChip[]; unknown: SelectorTerm[] } {
  const chips: TermChip[] = [];
  const owners: OwnerChip[] = [];
  const unknown: SelectorTerm[] = [];
  for (const term of terms) {
    if (isOwnerTerm(term)) {
      const owner = ownerChipOf(term, context);
      if (owner === undefined) {
        unknown.push(term);
      } else {
        owners.push(owner);
      }
      continue;
    }
    const chip = chipOf(term, context);
    if (chip === undefined) {
      unknown.push(term);
    } else {
      chips.push(chip);
    }
  }
  return { chips, owners, unknown };
}

function ownerChipOf(term: OwnerTerm, context: LabelContext): OwnerChip | undefined {
  if (term.owner === '*' || term.owner === '#') {
    return { term, text: `owner=${term.owner}` };
  }
  const ship = context.ships.find((each) => each.id === term.owner);
  return ship === undefined ? undefined : { term, text: `owner=${ship.name}` };
}

function chipOf(term: LabelTerm, context: LabelContext): TermChip | undefined {
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
function sameValueAlone(rule: DraftRule, side: RuleSide): Exclude<LabelTerm, string>[] {
  const other = rule[side === 'from' ? 'to' : 'from'];
  return rule[side].filter(
    (term): term is Exclude<LabelTerm, string> => typeof term !== 'string' && !isOwnerTerm(term) && term.value === '#' && !other.some((each) => isSameTerm(each, term)),
  );
}

/** Whether a side holds the same owner and the other side does not: the fleet refuses that too, as `#` binds the owner on both sides. */
function sameOwnerAlone(rule: DraftRule, side: RuleSide): boolean {
  const hasSameOwner = (terms: readonly SelectorTerm[]) => terms.some((term) => isOwnerTerm(term) && term.owner === '#');
  return hasSameOwner(rule[side]) && !hasSameOwner(rule[side === 'from' ? 'to' : 'from']);
}

/** What the editor says under a side that holds a term of the same value or owner the other side does not; undefined when none. */
export function sameValueProblemOf(rule: DraftRule, at: { side: RuleSide; context: LabelContext }): string | undefined {
  const [term] = sameValueAlone(rule, at.side);
  if (term === undefined) {
    return sameOwnerAlone(rule, at.side) ? 'owner=# needs owner=# on the other side: # matches the same owner there.' : undefined;
  }
  const key = at.context.labels.find((label) => label.id === term.labelId)?.key ?? term.labelId;
  return `${key}=# needs ${key}=# on the other side: # matches the same value there.`;
}

/** Whether a rule of the draft holds a term of the same value or owner on one side only: the fleet refuses it, so the draft does not save. */
export function hasSameValueOnOneSide(draft: NetworkDraft): boolean {
  return (
    draft.kind === 'rules' &&
    draft.rules.some((rule) => sameValueAlone(rule, 'from').length + sameValueAlone(rule, 'to').length > 0 || sameOwnerAlone(rule, 'from') || sameOwnerAlone(rule, 'to'))
  );
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
