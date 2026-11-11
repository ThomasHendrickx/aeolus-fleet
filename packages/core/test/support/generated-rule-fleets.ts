/**
 * Seeded generated fleets for rule-match parity (#1741, proof step 1): every
 * selector shape on labels and the owner on both sides, empty selectors and
 * empty pairs, from-only rules, several values of one label, accounts with
 * groups, the installation, ship declarers, the person ship as owner, null
 * owners and open. Only rules the domain accepts are kept.
 */
import { idSchema, type LabelId, type LabelValueId, type NetworkRule, type NetworkVerb, type SelectorTerm, type ShipId, type ShipKind } from '@aeolus-fleet/common';

import type { DeclaredNetworkRules } from '../../src/domain/registry/declared-network-rules.js';
import type { LabelOwner } from '../../src/domain/registry/label.js';
import { invalidRule, type ReachingAccount, type ReachingActor, type ReachingLabel, type ReachingShip, type RulesInForce } from '../../src/domain/registry/network-settings.js';

const fleetId = idSchema('fleet').parse('flt_00000000000000000000000001');

export interface GeneratedLabel {
  id: LabelId;
  key: string;
  owner: LabelOwner;
  values: readonly LabelValueId[];
}

export interface GeneratedRuleFleet {
  seed: number;
  labels: readonly GeneratedLabel[];
  ships: readonly ReachingShip[];
  inForce: RulesInForce;
  subjects: readonly ReachingActor[];
}

/** mulberry32: a small seeded generator, so a failing seed reproduces. */
function randomOf(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export const generatedShipId = (index: number): ShipId => idSchema('ship').parse(`shp_${String(index).padStart(26, '0')}`);
const labelIdOf = (index: number): LabelId => idSchema('label').parse(`lbl_${String(index).padStart(26, '0')}`);
const valueIdOf = (label: number, value: number): LabelValueId => idSchema('labelValue').parse(`lbv_${String(label * 10 + value).padStart(26, '0')}`);

const KINDS: readonly ShipKind[] = ['operator', 'viewer', 'plugin', 'person', 'person', 'agent', 'agent', 'agent', 'agent', 'agent', 'app', 'agent'];
const DECLARER_ONE = 6;
const DECLARER_TWO = 7;
const VERBS: readonly NetworkVerb[] = ['send', 'read', 'manage'];

export function aGeneratedRuleFleet(seed: number): GeneratedRuleFleet {
  const random = randomOf(seed);
  const chance = (probability: number) => random() < probability;
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) {
      throw new Error('Nothing to pick from');
    }
    return item;
  };
  const shipIds = KINDS.map((_, index) => generatedShipId(index + 1));
  const installation: LabelOwner = { kind: 'installation' };
  const labels: GeneratedLabel[] = [
    { id: labelIdOf(1), key: 'group', owner: installation, values: [valueIdOf(1, 1), valueIdOf(1, 2), valueIdOf(1, 3)] },
    { id: labelIdOf(2), key: 'tier', owner: installation, values: [valueIdOf(2, 1), valueIdOf(2, 2)] },
    { id: labelIdOf(3), key: 'team', owner: { kind: 'ship', shipId: generatedShipId(DECLARER_ONE) }, values: [valueIdOf(3, 1), valueIdOf(3, 2), valueIdOf(3, 3)] },
    { id: labelIdOf(4), key: 'zone', owner: { kind: 'ship', shipId: generatedShipId(DECLARER_ONE) }, values: [valueIdOf(4, 1), valueIdOf(4, 2)] },
    { id: labelIdOf(5), key: 'role', owner: { kind: 'ship', shipId: generatedShipId(DECLARER_TWO) }, values: [valueIdOf(5, 1), valueIdOf(5, 2)] },
  ];
  const carriedOf = (pool: readonly GeneratedLabel[], probability: number): ReachingLabel[] =>
    pool.flatMap((label) => label.values.filter(() => chance(probability)).map((valueId) => ({ labelId: label.id, valueId })));
  const people = shipIds.filter((_, index) => KINDS[index] === 'person');
  const owners: readonly (ShipId | null)[] = [null, null, ...people, generatedShipId(1), generatedShipId(6), generatedShipId(9)];
  const ownerOf = shipIds.map((id, index) => (KINDS[index] === 'person' ? id : pick(owners)));
  const ships: ReachingShip[] = shipIds.map((id, index) => {
    const owner = ownerOf[index] ?? null;
    return {
      id,
      kind: KINDS[index] ?? 'agent',
      owner,
      isOwnedByPerson: owner !== null && people.includes(owner),
      labels: carriedOf(labels, 0.3),
    };
  });

  const termOf = (pool: readonly GeneratedLabel[], hasOwnerTerms: boolean): SelectorTerm => {
    const roll = random();
    if (hasOwnerTerms && roll < 0.2) {
      const owner = pick<'*' | '#' | ShipId>(['*', '#', ...people, generatedShipId(6)]);
      return { owner };
    }
    const label = pick(pool);
    if (roll < 0.55) {
      return pick(label.values);
    }
    return { labelId: label.id, value: roll < 0.75 ? '*' : '#' };
  };
  const ruleOf = (pool: readonly GeneratedLabel[], hasOwnerTerms: boolean): NetworkRule | undefined => {
    const selector = () => Array.from({ length: Math.floor(random() * 4) }, () => termOf(pool, hasOwnerTerms));
    const from = selector();
    const to = selector();
    // A term of the same value binds both sides, so it is added to the other side.
    const isSame = (term: SelectorTerm) => typeof term !== 'string' && (('owner' in term && term.owner === '#') || ('value' in term && term.value === '#'));
    const text = (term: SelectorTerm) => JSON.stringify(term);
    for (const term of from.filter(isSame)) {
      if (!to.some((other) => text(other) === text(term))) {
        to.push(term);
      }
    }
    for (const term of to.filter(isSame)) {
      if (!from.some((other) => text(other) === text(term))) {
        from.push(term);
      }
    }
    const unique = (selector: SelectorTerm[]) => selector.filter((term, index) => selector.findIndex((other) => text(other) === text(term)) === index);
    const rule: NetworkRule = { verb: pick(VERBS), from: unique(from), to: unique(to) };
    return invalidRule(rule) === undefined ? rule : undefined;
  };
  const rulesOf = (count: number, pool: readonly GeneratedLabel[], hasOwnerTerms: boolean): NetworkRule[] =>
    Array.from({ length: count }, () => ruleOf(pool, hasOwnerTerms)).flatMap((rule) => (rule === undefined ? [] : [rule]));
  const ownedBy = (owner: LabelOwner) => labels.filter((label) => JSON.stringify(label.owner) === JSON.stringify(owner));
  const declarationOf = (declarer: LabelOwner): DeclaredNetworkRules => ({ fleetId, declarer, rules: rulesOf(Math.floor(random() * 5), ownedBy(declarer), false) });
  const declared = [
    declarationOf(installation),
    declarationOf({ kind: 'ship', shipId: generatedShipId(DECLARER_ONE) }),
    declarationOf({ kind: 'ship', shipId: generatedShipId(DECLARER_TWO) }),
  ];
  const isOpen = chance(0.1);
  const inForce: RulesInForce = { isOpen, isViewerReadOn: chance(0.5), rules: isOpen ? [] : rulesOf(Math.floor(random() * 7), labels, true), declared };
  const groups = labels.filter((label) => label.key === 'group');
  const accounts: ReachingAccount[] = [
    { kind: 'account', personShipId: people[0] ?? null, labels: carriedOf(groups, 0.5) },
    { kind: 'account', personShipId: null, labels: carriedOf(groups, 0.5) },
    { kind: 'account', personShipId: people[1] ?? null, labels: [] },
  ];
  return { seed, labels, ships, inForce, subjects: [...ships, ...accounts, { kind: 'installation' }] };
}

/** The ship declarers of the labels carried: the only declarers whose nonempty selectors can hold for them (decision 0037). */
export function declarersOfCarried(fleet: GeneratedRuleFleet, carried: readonly ReachingLabel[]): ReadonlySet<ShipId> {
  return new Set(carried.flatMap((value) => {
    const owner = fleet.labels.find((label) => label.id === value.labelId)?.owner;
    return owner?.kind === 'ship' ? [owner.shipId] : [];
  }));
}
