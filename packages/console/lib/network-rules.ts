import type { LabelValueId, NetworkRule } from '@aeolus-fleet/common';

import { pickedChips, type LabelChip, type LabelContext } from './labels';

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
  from: readonly LabelValueId[];
  to: readonly LabelValueId[];
}

export type NetworkDraft = { kind: 'all-to-all' } | { kind: 'rules'; rules: readonly DraftRule[] };

export type RuleSide = 'from' | 'to';

/** The most rules a fleet holds and the most values one selector holds, as common states them. */
export interface NetworkLimits {
  rulesMax: number;
  selectorMax: number;
}

/** What a save did at the fleet, as the networking plugin answers it. */
export type Supply = 'supplied' | 'waiting' | 'not-connected' | 'unregistered';

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
export function addRule(draft: NetworkDraft, newKey: () => string, limits: NetworkLimits): NetworkDraft {
  if (draft.kind === 'all-to-all' || draft.rules.length >= limits.rulesMax) {
    return draft;
  }
  return { kind: 'rules', rules: [...draft.rules, { key: newKey(), from: [], to: [] }] };
}

export function removeRule(draft: NetworkDraft, key: string): NetworkDraft {
  return draft.kind === 'all-to-all' ? draft : { kind: 'rules', rules: draft.rules.filter((rule) => rule.key !== key) };
}

function changeRule(draft: NetworkDraft, key: string, change: (rule: DraftRule) => DraftRule): NetworkDraft {
  return draft.kind === 'all-to-all' ? draft : { kind: 'rules', rules: draft.rules.map((rule) => (rule.key === key ? change(rule) : rule)) };
}

/** Adds a value to one side of a rule: once, and none past the most a selector holds. */
export function addValue(draft: NetworkDraft, at: { rule: string; side: RuleSide; valueId: LabelValueId }, limits: NetworkLimits): NetworkDraft {
  return changeRule(draft, at.rule, (rule) => {
    const values = rule[at.side];
    if (values.includes(at.valueId) || values.length >= limits.selectorMax) {
      return rule;
    }
    return { ...rule, [at.side]: [...values, at.valueId] };
  });
}

export function removeValue(draft: NetworkDraft, at: { rule: string; side: RuleSide; valueId: LabelValueId }): NetworkDraft {
  return changeRule(draft, at.rule, (rule) => ({ ...rule, [at.side]: rule[at.side].filter((valueId) => valueId !== at.valueId) }));
}

/** Whether the draft differs from the rules the plugin holds; all-to-all is never an empty list. */
export function isChanged(draft: NetworkDraft, saved: readonly NetworkRule[] | null): boolean {
  return JSON.stringify(rulesOf(draft)) !== JSON.stringify(saved);
}

/**
 * One side of a rule as the editor shows it: a chip per value, and the values
 * the fleet no longer has, which match no ship (decision 0034).
 */
export function selectorOf(valueIds: readonly LabelValueId[], context: LabelContext): { chips: LabelChip[]; unknown: LabelValueId[] } {
  const chips = pickedChips(valueIds, context);
  return { chips, unknown: valueIds.filter((valueId) => !chips.some((chip) => chip.valueId === valueId)) };
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
