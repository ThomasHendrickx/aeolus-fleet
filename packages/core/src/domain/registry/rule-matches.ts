/**
 * Rule matches (design person-ship-reads/rule-matches.md, #1741): derived data
 * that lets a person ship read check current send and read rights per
 * candidate with bounded work, whatever the fleet's policy.
 *
 * A rule source is the fleet's own rules, the installation's declaration or
 * one ship's declaration; a rule is named by its source and its place in that
 * source's list. Split every term of the same value into a one-sided part
 * (carrying some value of the label, having an owner) and a pair part (both
 * sides share a value of the label, or the owner). Then
 *
 *   from(a) AND to(c) = from'(a) AND to'(c) AND every pair key of the rule is shared by a and c
 *
 * where from' and to' read each such term as its one-sided part. A ship's
 * rule match stores, per verb and source, the rules whose nonempty `to'`
 * holds for it, and of those the ones with an empty `from`, which grant every
 * actor. A call computes, for its subject only, which rules' `from'` hold and
 * which pair keys they need; a candidate is then granted by a built-in, a
 * collapse to every candidate, or a stored rule both sides meet with no
 * unshared pair key. The authoritative rules stay in their own tables; these
 * rows are rewritten in the same transaction as every change they derive from.
 */
import { isOwnerTerm, type LabelId, type LabelValueId, type NetworkVerb, type SelectorTerm, type ShipId, type ShipKind } from '@aeolus-fleet/common';

import type { DeclaredNetworkRules } from './declared-network-rules.js';
import type { LabelOwner } from './label.js';
import { matchesOneSided, owningShipOf, selectedOf, type NetworkRule, type ReachingActor, type ReachingLabel, type ReachingShip, type RulesInForce } from './network-settings.js';

/** The verbs the person ship reads check; manage is not stored. */
export type MatchedVerb = Extract<NetworkVerb, 'read' | 'send'>;
export const MATCHED_VERBS: readonly MatchedVerb[] = ['send', 'read'];

/** Where a rule comes from: the fleet's own rules, or a declarer's declaration. */
export type RuleSource = { kind: 'fleet' } | LabelOwner;

export interface RuleSourceRules {
  source: RuleSource;
  rules: readonly NetworkRule[];
}

/** One ship's matches for one verb and source; a ship meeting none of its rules has no row. */
export interface RuleMatch {
  shipId: ShipId;
  verb: MatchedVerb;
  source: RuleSource;
  /** Places of the rules of this verb with a nonempty `to` whose one-sided reading holds for the ship. */
  toRules: readonly number[];
  /** Of those, the rules with an empty `from`: they grant every actor. */
  toRulesEveryActor: readonly number[];
}

/** What the matches of a ship derive from: its carried values and its owner. */
export type MatchedShip = Pick<ReachingShip, 'id' | 'owner' | 'labels'>;

export function isSameSource(source: RuleSource, other: RuleSource): boolean {
  if (source.kind === 'ship') {
    return other.kind === 'ship' && other.shipId === source.shipId;
  }
  return source.kind === other.kind;
}

/**
 * The sources that can hold for an actor carrying values of these ship
 * declarers' labels: the fleet's own rules, the installation's declaration,
 * and those declarers' declarations. Every term of a declared rule is on a
 * label its declarer owns (decision 0037), so another ship declarer's
 * nonempty selector never holds for the actor.
 */
export function ruleSourcesOf(inForce: Pick<RulesInForce, 'rules' | 'declared'>, declarers: ReadonlySet<ShipId>): RuleSourceRules[] {
  const declared = inForce.declared.filter(({ declarer }) => declarer.kind === 'installation' || declarers.has(declarer.shipId));
  return [{ source: { kind: 'fleet' }, rules: inForce.rules }, ...declared.map(({ declarer, rules }) => ({ source: declarer, rules }))];
}

/** A ship's rule matches, per verb and source, from the rules of the sources concerned. */
export function ruleMatchesOf(ship: MatchedShip, sources: readonly RuleSourceRules[]): RuleMatch[] {
  const actor: ReachingShip = { ...ship, kind: 'agent', isOwnedByPerson: false };
  return sources.flatMap(({ source, rules }) =>
    MATCHED_VERBS.flatMap((verb) => {
      const toRules = placesOf(rules, (rule) => rule.verb === verb && rule.to.length > 0 && matchesOneSided(rule.to, actor));
      if (toRules.length === 0) {
        return [];
      }
      return [{ shipId: ship.id, verb, source, toRules, toRulesEveryActor: toRules.filter((place) => rules[place]?.from.length === 0) }];
    }),
  );
}

/** The verbs some ship declaration grants to every actor for every candidate, by a rule with an empty `from` and an empty `to`. */
export function everyCandidateVerbsOf(declared: readonly DeclaredNetworkRules[]): MatchedVerb[] {
  return MATCHED_VERBS.filter((verb) =>
    declared.some(({ declarer, rules }) => declarer.kind === 'ship' && rules.some((rule) => rule.verb === verb && rule.from.length === 0 && rule.to.length === 0)),
  );
}

/** What a call loads for its subject: open, the viewer switch, the sources that can hold for it, and the ship declarations' universal grants. */
export interface SubjectRuleSources {
  isOpen: boolean;
  isViewerReadOn: boolean;
  sources: readonly RuleSourceRules[];
  everyCandidateVerbs: readonly MatchedVerb[];
}

/** A shared key a rule's terms of the same value need: a label, or the owner. */
export type PairKey = { kind: 'label'; labelId: LabelId } | { kind: 'owner' };

export interface PairEntry {
  source: RuleSource;
  key: PairKey;
  /** The subject's matching rules of this source that hold a term of the same value on the key. */
  rules: readonly number[];
}

/** The subject's side of the decision for one verb, bounded by its own facts, never by the fleet's policy size. */
export type RuleMatchFilter =
  | { isEvery: true }
  | {
      isEvery: false;
      verb: MatchedVerb;
      /** Built-ins: the ship the subject owns ships as, the kinds every subject reaches, and the subject reading itself. */
      ownedBy: ShipId | null;
      kinds: readonly ShipKind[];
      self: ShipId | null;
      /** Per source the subject meets, its rules with a nonempty `from` whose one-sided reading holds for the subject. */
      sources: readonly { source: RuleSource; fromRules: readonly number[] }[];
      /** The subject's values on labels its pair entries name, and its owner when an entry names the owner. */
      pairValues: readonly LabelValueId[];
      pairOwner: ShipId | null;
      pairEntries: readonly PairEntry[];
    };

/**
 * The subject's filter: every candidate when open, for argo, a plugin
 * reading or sending, the viewer reading while on, a rule of the subject's
 * with an empty `to`, or an empty pair; otherwise the built-ins, the rules
 * whose `from` holds for it on its own side, and the pair keys they need.
 */
export function ruleMatchFilterOf(rules: SubjectRuleSources, check: { subject: ReachingActor; verb: MatchedVerb }): RuleMatchFilter {
  const { subject, verb } = check;
  if (rules.isOpen || subject.kind === 'operator' || subject.kind === 'plugin' || (verb === 'read' && subject.kind === 'viewer' && rules.isViewerReadOn) || rules.everyCandidateVerbs.includes(verb)) {
    return { isEvery: true };
  }
  const sources: { source: RuleSource; fromRules: number[] }[] = [];
  const pairEntries: PairEntry[] = [];
  for (const { source, rules: sourceRules } of rules.sources) {
    const ofVerb = sourceRules.map((rule, place) => ({ rule, place })).filter(({ rule }) => rule.verb === verb);
    if (ofVerb.some(({ rule }) => rule.to.length === 0 && matchesOneSided(rule.from, subject))) {
      // Without a `to` there is no term of the same value: the rule holds for the subject and every candidate.
      return { isEvery: true };
    }
    const meeting = ofVerb.filter(({ rule }) => rule.from.length > 0 && matchesOneSided(rule.from, subject));
    if (meeting.length === 0) {
      continue;
    }
    sources.push({ source, fromRules: meeting.map(({ place }) => place) });
    const byKey = new Map<string, { key: PairKey; rules: number[] }>();
    for (const { rule, place } of meeting) {
      for (const key of pairKeysOf(rule)) {
        const text = key.kind === 'owner' ? 'owner' : key.labelId;
        const entry = byKey.get(text) ?? { key, rules: [] };
        entry.rules.push(place);
        byKey.set(text, entry);
      }
    }
    pairEntries.push(...[...byKey.values()].map(({ key, rules: places }) => ({ source, key, rules: places })));
  }
  const selected = selectedOf(subject);
  const pairLabels = new Set(pairEntries.flatMap(({ key }) => (key.kind === 'label' ? [key.labelId] : [])));
  return {
    isEvery: false,
    verb,
    ownedBy: owningShipOf(subject),
    kinds: verb === 'send' ? ['operator', 'plugin'] : [],
    self: verb === 'read' && 'id' in subject ? subject.id : null,
    sources,
    pairValues: selected.labels.filter(({ labelId }) => pairLabels.has(labelId)).map(({ valueId }) => valueId),
    pairOwner: pairEntries.some(({ key }) => key.kind === 'owner') ? selected.owner : null,
    pairEntries,
  };
}

/** A candidate as the decision sees it: its id, kind, owner and carried values, and its stored rule matches. */
export interface MatchedCandidate {
  candidate: Pick<ReachingShip, 'id' | 'kind' | 'owner' | 'labels'>;
  matches: readonly RuleMatch[];
}

/** Whether the filter grants the candidate: the in-memory form of the decision the database renders. */
export function isGrantedByRuleMatches(filter: RuleMatchFilter, matched: MatchedCandidate): boolean {
  if (filter.isEvery) {
    return true;
  }
  const { candidate, matches } = matched;
  if ((filter.ownedBy !== null && candidate.owner === filter.ownedBy) || filter.kinds.includes(candidate.kind) || candidate.id === filter.self) {
    return true;
  }
  const isShared = (key: PairKey): boolean =>
    key.kind === 'owner'
      ? candidate.owner !== null && candidate.owner === filter.pairOwner
      : candidate.labels.some((label: ReachingLabel) => label.labelId === key.labelId && filter.pairValues.includes(label.valueId));
  return matches.some((match) => {
    if (match.verb !== filter.verb) {
      return false;
    }
    if (match.toRulesEveryActor.length > 0) {
      return true;
    }
    const meeting = filter.sources.find(({ source }) => isSameSource(source, match.source));
    if (meeting === undefined) {
      return false;
    }
    const needed = new Set(filter.pairEntries.filter((entry) => isSameSource(entry.source, match.source) && !isShared(entry.key)).flatMap((entry) => entry.rules));
    return match.toRules.some((place) => meeting.fromRules.includes(place) && !needed.has(place));
  });
}

/** The keys a rule's terms of the same value bind; validation puts each on both sides. */
function pairKeysOf(rule: NetworkRule): PairKey[] {
  const keys: PairKey[] = [];
  const seen = new Set<string>();
  for (const term of [...rule.from, ...rule.to]) {
    const key = pairKeyOf(term);
    const text = key === undefined ? undefined : key.kind === 'owner' ? 'owner' : key.labelId;
    if (key !== undefined && text !== undefined && !seen.has(text)) {
      seen.add(text);
      keys.push(key);
    }
  }
  return keys;
}

function pairKeyOf(term: SelectorTerm): PairKey | undefined {
  if (typeof term === 'string') {
    return undefined;
  }
  if (isOwnerTerm(term)) {
    return term.owner === '#' ? { kind: 'owner' } : undefined;
  }
  return term.value === '#' ? { kind: 'label', labelId: term.labelId } : undefined;
}

function placesOf(rules: readonly NetworkRule[], isMet: (rule: NetworkRule) => boolean): number[] {
  return rules.flatMap((rule, place) => (isMet(rule) ? [place] : []));
}
