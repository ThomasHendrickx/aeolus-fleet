/** A fixed subject's reach expressed as candidate predicates, without enumerating ships. */
import { isOwnerTerm, type LabelId, type LabelValueId, type NetworkVerb, type SelectorTerm, type ShipId, type ShipKind } from '@aeolus-fleet/common';

import { owningShipOf, selectedOf, type NetworkRule, type ReachingActor, type RulesInForce } from './network-settings.js';

export type PersonPermissionTerm =
  | { kind: 'value'; valueId: LabelValueId }
  | { kind: 'label'; labelId: LabelId; valueIds: readonly LabelValueId[] | null }
  | { kind: 'owner'; shipId: ShipId | null }
  | { kind: 'ship'; shipId: ShipId }
  | { kind: 'kind'; shipKind: ShipKind };

type Clause = readonly PersonPermissionTerm[];
type ClausesBy<Key> = ReadonlyMap<Key, readonly Clause[]>;
type CollectedBy<Key> = Map<Key, Clause[]>;

export interface PersonPermissionPlan {
  isEvery: boolean;
  anyOf: readonly Clause[];
  valueIds: readonly LabelValueId[];
  labelIds: readonly LabelId[];
  valuePairs: ReadonlyMap<LabelValueId, readonly LabelValueId[]>;
  byValue: ClausesBy<LabelValueId>;
  byLabel: ClausesBy<LabelId>;
}

/** Compile read/send reach; indexed clauses keep many declarers out of SQL syntax. */
export function personPermissionPlan(inForce: RulesInForce, read: { subject: ReachingActor; verb: Extract<NetworkVerb, 'read' | 'send'> }): PersonPermissionPlan {
  const { subject, verb } = read;
  if (inForce.isOpen || subject.kind === 'operator' || subject.kind === 'plugin' || (verb === 'read' && subject.kind === 'viewer' && inForce.isViewerReadOn)) {
    return everyPlan();
  }
  const anyOf = new Map<string, Clause>();
  const seen = new Set<string>();
  const valueIds = new Set<LabelValueId>();
  const labelIds = new Set<LabelId>();
  const valuePairs = new Map<LabelValueId, LabelValueId[]>();
  const pairsSeen = new Set<string>();
  const byValue: CollectedBy<LabelValueId> = new Map();
  const byLabel: CollectedBy<LabelId> = new Map();
  const rememberValues = (first: LabelValueId, second?: LabelValueId): void => {
    if (second === undefined || first === second) { valueIds.add(first); return; }
    const isAscending = first < second;
    const left = isAscending ? first : second;
    const right = isAscending ? second : first;
    const pair = `${left}:${right}`;
    if (!pairsSeen.has(pair)) {
      pairsSeen.add(pair);
      const held = valuePairs.get(left);
      if (held === undefined) { valuePairs.set(left, [right]); } else { held.push(right); }
    }
  };
  for (const raw of candidateClauses(inForce, { ...read, rememberValues })) {
    const [only] = raw;
    if (raw.length === 1 && only?.kind === 'value') { rememberValues(only.valueId); continue; }
    if (raw.length === 1 && only?.kind === 'label' && only.valueIds === null) { labelIds.add(only.labelId); continue; }
    const [first, second] = raw;
    if (raw.length === 2 && first?.kind === 'value' && second?.kind === 'value') { rememberValues(first.valueId, second.valueId); continue; }
    const { terms, key } = normalized(raw);
    if (terms.length === 0) {
      return everyPlan();
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    // Every indexed clause needs this carried value or label. Candidate lookup
    // therefore examines only its own labels, not every declared predicate.
    const anchor = terms.find((term) => term.kind === 'value') ?? terms.find((term) => term.kind === 'label');
    if (anchor?.kind === 'value') {
      remember(byValue, { key: anchor.valueId, terms: terms.filter((term) => term !== anchor) });
    } else if (anchor?.kind === 'label') {
      remember(byLabel, { key: anchor.labelId, terms: anchor.valueIds === null ? terms.filter((term) => term !== anchor) : terms });
    } else {
      // Owner/kind/self clauses have no label. Declared rules cannot contain
      // owner terms, so these remain bounded by the fleet's own rule limit.
      anyOf.set(key, terms);
    }
  }
  return { isEvery: false, anyOf: [...anyOf.values()], valueIds: [...valueIds], labelIds: [...labelIds], valuePairs, byValue, byLabel };
}

function everyPlan(): PersonPermissionPlan {
  return { isEvery: true, anyOf: [], valueIds: [], labelIds: [], valuePairs: new Map(), byValue: new Map(), byLabel: new Map() };
}

function termKey(term: PersonPermissionTerm): string {
  switch (term.kind) {
    case 'value': return `value:${term.valueId}`;
    case 'label': return `label:${term.labelId}:${term.valueIds === null ? '*' : term.valueIds.join(',')}`;
    case 'owner': return `owner:${term.shipId ?? '*'}`;
    case 'ship': return `ship:${term.shipId}`;
    case 'kind': return `kind:${term.shipKind}`;
  }
}

function normalized(terms: Clause): { terms: Clause; key: string } {
  const entries = [...new Map(terms.map((term) => [termKey(term), term])).entries()]
    .sort(([one], [other]) => one < other ? -1 : one > other ? 1 : 0);
  return { terms: entries.map(([, term]) => term), key: entries.map(([key]) => key).join('|') };
}

function remember<Key>(target: CollectedBy<Key>, clause: { key: Key; terms: Clause }): void {
  const clauses = target.get(clause.key);
  if (clauses === undefined) {
    target.set(clause.key, [clause.terms]);
  } else {
    clauses.push(clause.terms);
  }
}

function* rulesOf(inForce: RulesInForce): Generator<NetworkRule> {
  yield* inForce.rules;
  for (const declaration of inForce.declared) { yield* declaration.rules; }
}

function* candidateClauses(inForce: RulesInForce, read: { subject: ReachingActor; verb: 'read' | 'send'; rememberValues: (first: LabelValueId, second?: LabelValueId) => void }): Generator<Clause> {
  const { subject, verb } = read;
  const owningShipId = owningShipOf(subject);
  if (owningShipId !== null) {
    yield [{ kind: 'owner', shipId: owningShipId }];
  }
  if (verb === 'send') {
    yield [{ kind: 'kind', shipKind: 'operator' }];
    yield [{ kind: 'kind', shipKind: 'plugin' }];
  } else if ('id' in subject) {
    yield [{ kind: 'ship', shipId: subject.id }];
  }
  for (const rule of rulesOf(inForce)) {
    if (rule.verb === verb) {
      // Common declaration shapes go directly into the indexed plan, avoiding
      // transient term objects and generator yields for tens of thousands of rules.
      const [first, second] = rule.to;
      if (rule.from.length === 0 && typeof first === 'string' && (rule.to.length === 1 || (rule.to.length === 2 && typeof second === 'string'))) {
        read.rememberValues(first, typeof second === 'string' ? second : undefined);
        continue;
      }
      const terms = candidateTerms(subject, rule);
      if (terms !== undefined) {
        yield terms;
      }
    }
  }
}

function candidateTerms(subject: ReachingActor, rule: { from: readonly SelectorTerm[]; to: readonly SelectorTerm[] }): PersonPermissionTerm[] | undefined {
  const facts = selectedOf(subject);
  const terms: PersonPermissionTerm[] = [];
  for (const term of rule.from) {
    if (typeof term === 'string') {
      if (!facts.labels.some((label) => label.valueId === term)) {
        return undefined;
      }
    } else if (isOwnerTerm(term)) {
      if (term.owner === '#') {
        if (facts.owner === null) {
          return undefined;
        }
        terms.push({ kind: 'owner', shipId: facts.owner });
      } else if (term.owner === '*' ? facts.owner === null : facts.owner !== term.owner) {
        return undefined;
      }
    } else {
      const values = facts.labels.filter((label) => label.labelId === term.labelId).map((label) => label.valueId).sort();
      if (values.length === 0) {
        return undefined;
      }
      if (term.value === '#') {
        terms.push({ kind: 'label', labelId: term.labelId, valueIds: values });
      }
    }
  }
  for (const term of rule.to) {
    if (typeof term === 'string') {
      terms.push({ kind: 'value', valueId: term });
    } else if (isOwnerTerm(term)) {
      if (term.owner === '#' && facts.owner === null) {
        return undefined;
      }
      terms.push({ kind: 'owner', shipId: term.owner === '*' ? null : term.owner === '#' ? facts.owner : term.owner });
    } else {
      const values = term.value === '*' ? null : facts.labels.filter((label) => label.labelId === term.labelId).map((label) => label.valueId).sort();
      if (values?.length === 0) {
        return undefined;
      }
      terms.push({ kind: 'label', labelId: term.labelId, valueIds: values });
    }
  }
  return terms;
}
