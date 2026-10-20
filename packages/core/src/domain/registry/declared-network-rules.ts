/**
 * The network rules a ship or the installation declares on the labels it owns
 * (decisions 0037, 0052), such as a plugin's for the ships it labels, or the
 * installation's on `group`. They are in force beside the fleet's own rules,
 * merged at check time, so a declaration moves the settings version.
 * Only rules on labels the declarer owns keep them safe: only an actor
 * holding labels:any assigns those labels besides it, so its rules reach no
 * ship it did not label.
 */
import { DECLARED_NETWORK_RULES_MAX, isOwnerTerm, type FleetId, type LabelId, type LabelTerm, type LabelValueId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import { isSameOwner, type Label, type LabelOwner } from './label.js';
import { copyOfRule, invalidRule, termText, withDeclaredRulesChanged, type NetworkRule, type NetworkSettings } from './network-settings.js';

/** One declarer's declared rules, its whole list; a declarer that declares none holds none. */
export interface DeclaredNetworkRules {
  fleetId: FleetId;
  /** A ship, or the installation (decision 0052); an account owns no label, so it declares none. */
  declarer: LabelOwner;
  rules: readonly NetworkRule[];
}

export type DeclareNetworkRulesRefusal = DomainError<'INVALID_NETWORK_RULES' | 'NOT_THE_LABEL_OWNER' | 'LABEL_NOT_FOUND' | 'LABEL_VALUE_NOT_FOUND' | 'ACCOUNT_OWNS_NO_LABEL'>;

/** The labels a declaration's terms name, as the fleet has them now, with each owner's name for a refusal. */
export interface NamedLabels {
  labels: readonly Label[];
  ownerNameOf: (label: Label) => string;
}

/** Every label and every exact value the rules' terms name, each once: what the caller looks up before declaring. */
export function namedInRules(rules: readonly NetworkRule[]): { labelIds: LabelId[]; valueIds: LabelValueId[] } {
  const terms = rules.flatMap((rule) => [...rule.from, ...rule.to]);
  return {
    labelIds: [...new Set(terms.flatMap((term) => (typeof term !== 'string' && !isOwnerTerm(term) ? [term.labelId] : [])))],
    valueIds: [...new Set(terms.flatMap((term) => (typeof term === 'string' ? [term] : [])))],
  };
}

/**
 * The declarer declares its whole list from now on, replacing what it
 * declared before; an empty list withdraws them. At most 20, each rule within
 * decision 0034's own limits, and every term on a label the declarer owns: an
 * exact value's label, and the label of a term of any or the same value; a
 * term of the owner is on no label, so it is refused. An
 * id the fleet does not have is refused, as its owner cannot be checked. An
 * account owns no label, so it declares nothing, not even none.
 * The settings move to the next version, as the rules in force change.
 * NetworkRulesDeclared names the declaring ship, none for the installation,
 * the number of rules, never them, and the settings version.
 */
export function declareNetworkRules(
  named: NamedLabels,
  change: { settings: NetworkSettings; declarer: LabelOwner | undefined; rules: readonly NetworkRule[]; at: Date; actor: Actor },
): Result<{ declared: DeclaredNetworkRules; settings: NetworkSettings; events: NewEvent[] }, DeclareNetworkRulesRefusal> {
  const { declarer, rules } = change;
  const { fleetId } = change.settings;
  if (rules.length > DECLARED_NETWORK_RULES_MAX) {
    return refuse('INVALID_NETWORK_RULES', `A ship declares at most ${String(DECLARED_NETWORK_RULES_MAX)} network rules (decision 0037)`);
  }
  const invalid = rules.map(invalidRule).find((broken) => broken !== undefined);
  if (invalid !== undefined) {
    return refuse('INVALID_NETWORK_RULES', `${invalid} (decision 0034)`);
  }
  const terms = rules.flatMap((rule) => [...rule.from, ...rule.to]);
  const ownerTerm = terms.find(isOwnerTerm);
  if (ownerTerm !== undefined) {
    return refuse('INVALID_NETWORK_RULES', `A declared rule holds only terms on labels the ship owns: ${termText(ownerTerm)} is a term of the owner (decision 0037)`);
  }
  for (const term of terms.filter((each): each is LabelTerm => !isOwnerTerm(each))) {
    const owned = checkOwnedTerm(named, { term, declarer });
    if (!owned.isOk) {
      return owned;
    }
  }
  if (declarer === undefined) {
    return refuse('ACCOUNT_OWNS_NO_LABEL', 'A ship or the installation declares network rules on the labels it owns; an account owns none');
  }
  const settings = withDeclaredRulesChanged(change.settings);
  return ok({
    declared: { fleetId, declarer, rules: rules.map(copyOfRule) },
    settings,
    events: [declaredEvent({ fleetId, declarer, rules: rules.length, version: settings.version, at: change.at, actor: change.actor })],
  });
}

/**
 * The retired ship's declared rules go with it, as its labels do (decision
 * 0031): none from now on, the settings at their next version, with
 * NetworkRulesDeclared of none. A ship that declared none changes nothing.
 */
export function withdrawWithRetiredShip(
  current: DeclaredNetworkRules | undefined,
  change: { settings: NetworkSettings; at: Date; actor: Actor },
): { declared: DeclaredNetworkRules; settings: NetworkSettings; events: NewEvent[] } | undefined {
  if (current === undefined) {
    return undefined;
  }
  const { fleetId, declarer } = current;
  const settings = withDeclaredRulesChanged(change.settings);
  return { declared: { fleetId, declarer, rules: [] }, settings, events: [declaredEvent({ fleetId, declarer, rules: 0, version: settings.version, at: change.at, actor: change.actor })] };
}

function declaredEvent(declared: { fleetId: FleetId; declarer: LabelOwner; rules: number; version: number; at: Date; actor: Actor }): NewEvent {
  const { fleetId, declarer, at, actor } = declared;
  return {
    type: 'NetworkRulesDeclared',
    fleetId,
    occurredAt: at,
    actor,
    ...(declarer.kind === 'ship' ? { shipId: declarer.shipId } : {}),
    details: { rules: declared.rules, version: declared.version },
  };
}

function checkOwnedTerm(named: NamedLabels, declaring: { term: LabelTerm; declarer: LabelOwner | undefined }): Result<void, DeclareNetworkRulesRefusal> {
  const { term, declarer } = declaring;
  const label =
    typeof term === 'string' ? named.labels.find((each) => each.values.some((value) => value.id === term)) : named.labels.find((each) => each.id === term.labelId);
  if (label === undefined) {
    return typeof term === 'string' ? refuse('LABEL_VALUE_NOT_FOUND', `The fleet has no label value ${term}`) : refuse('LABEL_NOT_FOUND', `The fleet has no label ${term.labelId}`);
  }
  return isSameOwner(label.owner, declarer)
    ? ok(undefined)
    : refuse('NOT_THE_LABEL_OWNER', `The label ${label.key} is owned by ${named.ownerNameOf(label)}: only its owner declares rules on it (decision 0037)`);
}
