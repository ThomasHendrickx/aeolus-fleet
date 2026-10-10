/**
 * The network rules a ship declares on the labels it owns (decision 0037),
 * such as a plugin's for the ships it labels. Declared, they are not in
 * force: the fleet's networking plugin adds them to argo's rules when it
 * supplies the list. Only rules on labels the ship owns keep them safe: only
 * it assigns those labels, so its rules reach no ship it did not label.
 */
import { DECLARED_NETWORK_RULES_MAX, type FleetId, type LabelId, type LabelValueId, type SelectorTerm, type ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Label } from './label.js';
import { copyOfRule, invalidRule, type NetworkRule } from './network-settings.js';

/** One ship's declared rules, its whole list; a ship that declares none holds none. */
export interface DeclaredNetworkRules {
  fleetId: FleetId;
  shipId: ShipId;
  rules: readonly NetworkRule[];
}

export type DeclareNetworkRulesRefusal = DomainError<'INVALID_NETWORK_RULES' | 'NOT_THE_LABEL_OWNER' | 'LABEL_NOT_FOUND' | 'LABEL_VALUE_NOT_FOUND'>;

/** The labels a declaration's terms name, as the fleet has them now, with each owner's name for a refusal. */
export interface NamedLabels {
  labels: readonly Label[];
  ownerNameOf: (shipId: ShipId) => string;
}

/** Every label and every exact value the rules' terms name, each once: what the caller looks up before declaring. */
export function namedInRules(rules: readonly NetworkRule[]): { labelIds: LabelId[]; valueIds: LabelValueId[] } {
  const terms = rules.flatMap((rule) => [...rule.from, ...rule.to]);
  return {
    labelIds: [...new Set(terms.flatMap((term) => (typeof term === 'string' ? [] : [term.labelId])))],
    valueIds: [...new Set(terms.flatMap((term) => (typeof term === 'string' ? [term] : [])))],
  };
}

/**
 * The ship declares its whole list from now on, replacing what it declared
 * before; an empty list withdraws them. At most 20, each rule within
 * decision 0034's own limits, and every term on a label the ship owns: an
 * exact value's label, and the label of a term of any or the same value. An
 * id the fleet does not have is refused, as its owner cannot be checked.
 * NetworkRulesDeclared names the ship and the number of rules, never them.
 */
export function declareNetworkRules(
  named: NamedLabels,
  change: { fleetId: FleetId; shipId: ShipId; rules: readonly NetworkRule[]; at: Date; actor: Actor },
): Result<{ declared: DeclaredNetworkRules; events: NewEvent[] }, DeclareNetworkRulesRefusal> {
  const { fleetId, shipId, rules } = change;
  if (rules.length > DECLARED_NETWORK_RULES_MAX) {
    return refuse('INVALID_NETWORK_RULES', `A ship declares at most ${String(DECLARED_NETWORK_RULES_MAX)} network rules (decision 0037)`);
  }
  const invalid = rules.map(invalidRule).find((broken) => broken !== undefined);
  if (invalid !== undefined) {
    return refuse('INVALID_NETWORK_RULES', `${invalid} (decision 0034)`);
  }
  for (const term of rules.flatMap((rule) => [...rule.from, ...rule.to])) {
    const owned = checkOwnedTerm(named, { term, shipId });
    if (!owned.isOk) {
      return owned;
    }
  }
  return ok({ declared: { fleetId, shipId, rules: rules.map(copyOfRule) }, events: [declaredEvent({ fleetId, shipId, rules: rules.length, at: change.at, actor: change.actor })] });
}

/**
 * The retired ship's declared rules go with it, as its labels do (decision
 * 0031): none from now on, with NetworkRulesDeclared of none. A ship that
 * declared none changes nothing.
 */
export function withdrawWithRetiredShip(
  current: DeclaredNetworkRules | undefined,
  change: { at: Date; actor: Actor },
): { declared: DeclaredNetworkRules; events: NewEvent[] } | undefined {
  if (current === undefined) {
    return undefined;
  }
  const { fleetId, shipId } = current;
  return { declared: { fleetId, shipId, rules: [] }, events: [declaredEvent({ fleetId, shipId, rules: 0, ...change })] };
}

function declaredEvent(declared: { fleetId: FleetId; shipId: ShipId; rules: number; at: Date; actor: Actor }): NewEvent {
  return { type: 'NetworkRulesDeclared', fleetId: declared.fleetId, occurredAt: declared.at, actor: declared.actor, shipId: declared.shipId, details: { rules: declared.rules } };
}

function checkOwnedTerm(named: NamedLabels, declaring: { term: SelectorTerm; shipId: ShipId }): Result<void, DeclareNetworkRulesRefusal> {
  const { term, shipId } = declaring;
  const label =
    typeof term === 'string' ? named.labels.find((each) => each.values.some((value) => value.id === term)) : named.labels.find((each) => each.id === term.labelId);
  if (label === undefined) {
    return typeof term === 'string' ? refuse('LABEL_VALUE_NOT_FOUND', `The fleet has no label value ${term}`) : refuse('LABEL_NOT_FOUND', `The fleet has no label ${term.labelId}`);
  }
  return label.ownerShipId === shipId
    ? ok(undefined)
    : refuse('NOT_THE_LABEL_OWNER', `The label ${label.key} is owned by ${named.ownerNameOf(label.ownerShipId)}: only its owner declares rules on it (decision 0037)`);
}
