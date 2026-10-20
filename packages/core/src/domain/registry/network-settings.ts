/**
 * The fleet's network settings (decision 0034): which ships may send to,
 * read or manage which. A rule names its verb and says that the ships
 * matching one selector may do it to the ships matching another; allow-only,
 * no deny rules, no precedence. The fleet holds its own rules, set whole by
 * applying a draft, or none for all-to-all, beside the switch of the viewer
 * reading, with a version that moves on every change of what is in force, so
 * a refusal names the settings that refused it.
 */
import {
  ANY_LABEL_VALUE,
  NETWORK_RULES_MAX,
  SAME_LABEL_VALUE,
  SHIP_LABELS_MAX,
  isOwnerTerm,
  type FleetId,
  type LabelId,
  type LabelValueId,
  type BuiltInRule,
  type NetworkVerb,
  type SelectorTerm,
  type SetBuiltInRuleInput,
  type ShipId,
  type ShipKind,
} from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { DeclaredNetworkRules } from './declared-network-rules.js';
import type { LabelOwner } from './label.js';

/** The ships for which every term of `from` holds may do its verb to the ships for which every term of `to` holds. */
export interface NetworkRule {
  verb: NetworkVerb;
  from: readonly SelectorTerm[];
  to: readonly SelectorTerm[];
}

export interface NetworkSettings {
  fleetId: FleetId;
  /** The fleet's own rules beside the built-in and the declared ones, as last applied; none while none are, all-to-all with open on. */
  rules: readonly NetworkRule[] | null;
  /** The viewer reading every ship, the one built-in rule an actor turns (decision 0034); on at fleet create. */
  isViewerReadOn: boolean;
  /** 0 until the fleet first changes its settings; one more on every change of what is in force. */
  version: number;
}

/** A fleet that never set rules: none applied, the viewer reading on, at version 0. */
export function noNetworkSettings(fleetId: FleetId): NetworkSettings {
  return { fleetId, rules: null, isViewerReadOn: true, version: 0 };
}

export type InvalidNetworkRules = DomainError<'INVALID_NETWORK_RULES'>;

/**
 * What breaks the decisions' limits on the fleet's own rules, said for the
 * caller with its decision, or undefined when they keep them: at most 200,
 * counted alone, beside the declared ones (decision 0037); each selector at
 * most 20 terms, as a ship carries no more label values, each term once, and
 * a term of the same value on a label on both sides of its rule, as it binds
 * that label there. An id need not exist: an unknown one matches no ship, as
 * in label selection. None, all-to-all, keeps them.
 */
export function invalidRules(rules: readonly NetworkRule[] | null): string | undefined {
  if (rules === null) {
    return undefined;
  }
  if (rules.length > NETWORK_RULES_MAX) {
    return `A fleet holds at most ${String(NETWORK_RULES_MAX)} network rules of its own, beside the ones its ships declared (decision 0037)`;
  }
  const invalid = rules.map(invalidRule).find((broken) => broken !== undefined);
  return invalid === undefined ? undefined : `${invalid} (decision 0034)`;
}

/**
 * The fleet's rules from now on, the draft's, replacing the ones it had, at
 * the next version, with NetworkRulesSet naming how many, none for
 * all-to-all. The caller saw the settings at `version`: once they moved, the
 * draft's reach may differ from what the caller looked at, so the apply is
 * refused and the draft kept.
 */
export function applyNetworkRules(
  current: NetworkSettings,
  change: { rules: readonly NetworkRule[] | null; version: number; at: Date; actor: Actor },
): Result<{ settings: NetworkSettings; events: NewEvent[] }, DomainError<'NETWORK_SETTINGS_CHANGED'>> {
  const { rules } = change;
  if (change.version !== current.version) {
    return refuse(
      'NETWORK_SETTINGS_CHANGED',
      `The network settings are at version ${String(current.version)} now, not ${String(change.version)}: look at the draft again before applying it`,
    );
  }
  const settings: NetworkSettings = { ...current, rules: rules === null ? null : rules.map(copyOfRule), version: current.version + 1 };
  return ok({
    settings,
    events: [
      {
        type: 'NetworkRulesSet',
        fleetId: current.fleetId,
        occurredAt: change.at,
        actor: change.actor,
        details: { version: settings.version, rules: rules === null ? null : rules.length },
      },
    ],
  });
}

/** The settings at the next version, as the declared rules in force changed with them (decision 0037). */
export function withDeclaredRulesChanged(current: NetworkSettings): NetworkSettings {
  return { ...current, version: current.version + 1 };
}

export type SetBuiltInRuleRefusal = DomainError<'BUILT_IN_RULE_FIXED'>;

/**
 * A built-in rule turned on or off, as its own action (decision 0034): the
 * viewer reading, by any actor holding fleet:network (decision 0053). argo,
 * the owner, the answer, a connected plugin's reading and the installation's
 * managing are never off, and open follows the applied rules, so turning them
 * is refused. A change moves the version and writes BuiltInRuleChanged; a
 * rule already as asked changes nothing.
 */
export function setBuiltInRule(
  current: NetworkSettings,
  change: { input: SetBuiltInRuleInput; at: Date; actor: Actor },
): Result<{ settings: NetworkSettings; events: NewEvent[] }, SetBuiltInRuleRefusal> {
  const { input } = change;
  if (input.rule === 'open') {
    return refuse('BUILT_IN_RULE_FIXED', 'The built-in rule open is on exactly while the fleet has no rules applied (decision 0034)');
  }
  if (input.rule !== 'viewerRead') {
    return refuse('BUILT_IN_RULE_FIXED', `The built-in rule ${input.rule} is never off (decision 0034)`);
  }
  if (input.isOn === current.isViewerReadOn) {
    return ok({ settings: current, events: [] });
  }
  const settings: NetworkSettings = { ...current, isViewerReadOn: input.isOn, version: current.version + 1 };
  return ok({
    settings,
    events: [
      {
        type: 'BuiltInRuleChanged',
        fleetId: current.fleetId,
        occurredAt: change.at,
        actor: change.actor,
        details: { rule: input.rule, isOn: input.isOn, version: settings.version },
      },
    ],
  });
}

/** What breaks a rule's own limits, said for the caller, or undefined when it keeps them (decision 0034). */
export function invalidRule(rule: NetworkRule): string | undefined {
  return invalidSelector(rule.from) ?? invalidSelector(rule.to) ?? sameValueOnOneSide(rule);
}

function invalidSelector(selector: readonly SelectorTerm[]): string | undefined {
  if (selector.length > SHIP_LABELS_MAX) {
    return `A selector holds at most ${String(SHIP_LABELS_MAX)} terms, as a ship carries no more label values`;
  }
  const texts = selector.map(termText);
  const twice = texts.find((text, index) => texts.indexOf(text) !== index);
  return twice === undefined ? undefined : `A selector holds each term once: ${twice} twice`;
}

function sameValueOnOneSide(rule: NetworkRule): string | undefined {
  const [from, to] = [sameValueLabels(rule.from), sameValueLabels(rule.to)];
  const alone = [...from.filter((labelId) => !to.includes(labelId)), ...to.filter((labelId) => !from.includes(labelId))][0];
  if (alone !== undefined) {
    return `A term of the same value binds its label on both sides: ${termText({ labelId: alone, value: SAME_LABEL_VALUE })} is on one side only`;
  }
  return hasSameOwner(rule.from) === hasSameOwner(rule.to)
    ? undefined
    : `A term of the same owner binds the owner on both sides: ${termText({ owner: SAME_LABEL_VALUE })} is on one side only`;
}

/** A term as a refusal names it: an exact value by its id, a label term by its label id and symbol, an owner term by `owner` and its value. */
export function termText(term: SelectorTerm): string {
  if (typeof term === 'string') {
    return term;
  }
  return isOwnerTerm(term) ? `owner=${term.owner}` : `${term.labelId}=${term.value}`;
}

function sameValueLabels(selector: readonly SelectorTerm[]): LabelId[] {
  return selector.flatMap((term) => (typeof term !== 'string' && !isOwnerTerm(term) && term.value === SAME_LABEL_VALUE ? [term.labelId] : []));
}

function hasSameOwner(selector: readonly SelectorTerm[]): boolean {
  return selector.some((term) => isOwnerTerm(term) && term.owner === SAME_LABEL_VALUE);
}

/** A copy of the rule, so what is kept never changes with what was given. */
export function copyOfRule(rule: NetworkRule): NetworkRule {
  return { verb: rule.verb, from: rule.from.map(copyOfTerm), to: rule.to.map(copyOfTerm) };
}

function copyOfTerm(term: SelectorTerm): SelectorTerm {
  return typeof term === 'string' ? term : { ...term };
}

/**
 * What a check is made against (decisions 0034, 0037): open while the
 * fleet's own rules are none, all-to-all; the viewer reading as it was
 * turned; otherwise the fleet's own rules, then every declarer's, merged at
 * check time, each named by its place in its own list.
 */
export interface RulesInForce {
  isOpen: boolean;
  isViewerReadOn: boolean;
  rules: readonly NetworkRule[];
  declared: readonly DeclaredNetworkRules[];
}

/** The rules in force for the fleet's own rules, applied or a draft's, beside the declared ones. */
export function rulesInForce(own: { rules: readonly NetworkRule[] | null; isViewerReadOn: boolean }, declared: readonly DeclaredNetworkRules[]): RulesInForce {
  return { isOpen: own.rules === null, isViewerReadOn: own.isViewerReadOn, rules: own.rules ?? [], declared };
}

/** A label value a ship carries, with the label it is of, so a term of any or the same value finds it. */
export interface ReachingLabel {
  labelId: LabelId;
  valueId: LabelValueId;
}

/**
 * A ship as a send's check sees it: its id and owner, for the owner exception,
 * its kind, for the argo exception, whether argo connected it as a plugin,
 * whether its owner is a person ship, for the installation's rule, and the
 * label values it carries.
 */
export interface ReachingShip {
  id: ShipId;
  owner: ShipId | null;
  kind: ShipKind;
  isConnectedPlugin: boolean;
  /** Whether it is owned by a person ship, a person ship owning itself (decision 0045). */
  isOwnedByPerson: boolean;
  labels: readonly ReachingLabel[];
}

/**
 * An account as a check sees it (decision 0057): the label values of `group`
 * its token carries, and its person ship, which owns itself and through
 * which the account owns: a selector's owner terms see the person ship as
 * the account's owner.
 */
export interface ReachingAccount {
  kind: 'account';
  personShipId: ShipId | null;
  labels: readonly ReachingLabel[];
}

/** The installation as a check sees it: no labels, no owner; it manages person ships and what they own by its built-in rule. */
export interface ReachingInstallation {
  kind: 'installation';
}

/** Whoever does the verb: a ship, an account or the installation (decision 0057). */
export type ReachingActor = ReachingShip | ReachingAccount | ReachingInstallation;

/** What a selector sees of an actor: the owner its owner terms test, and the label values it carries. */
interface Selected {
  owner: ShipId | null;
  labels: readonly ReachingLabel[];
}

function selectedOf(actor: ReachingActor): Selected {
  if (actor.kind === 'account') {
    return { owner: actor.personShipId, labels: actor.labels };
  }
  return actor.kind === 'installation' ? { owner: null, labels: [] } : { owner: actor.owner, labels: actor.labels };
}

/** The ship the actor owns ships as: a ship itself, an account its person ship; the installation none. */
function owningShipOf(actor: ReachingActor): ShipId | null {
  if (actor.kind === 'account') {
    return actor.personShipId;
  }
  return actor.kind === 'installation' ? null : actor.id;
}

/**
 * The rule that lets the sender do the verb to the recipient, or undefined
 * when none does. The built-in rules that are never off hold whatever the
 * rules: argo reaches every ship and every ship reaches argo, but reads argo
 * only by a rule, so argo's messages are not every ship's to read; an owner's
 * ship reaches the ships it owns (decision 0045), and an account the ships
 * its person ship owns; a ship answers the sender of a message it received;
 * a plugin argo connected reads every ship; and the installation manages
 * person ships and the ships they own (decision 0020). The viewer reads
 * every ship while that is on, and every actor reaches every ship by every
 * verb while open is. Otherwise a rule of the verb must match the sender
 * with its `from` and the recipient with its `to`: one of the fleet's own,
 * named by its place in that list, or a declared one, named by its declarer
 * and its place in the declarer's list. The built-in rules come first, in
 * that order, as the rule list shows them.
 */
export function reachRuleOf(
  inForce: RulesInForce,
  send: { verb: NetworkVerb; sender: ReachingActor; recipient: ReachingShip; isAnswerToSender: boolean },
): ReachRule | undefined {
  const { verb, sender, recipient, isAnswerToSender } = send;
  if (sender.kind === 'operator' || (recipient.kind === 'operator' && verb !== 'read')) {
    return { builtIn: 'argo' };
  }
  const owningShip = owningShipOf(sender);
  if (owningShip !== null && recipient.owner === owningShip) {
    return { builtIn: 'owner' };
  }
  if (verb === 'send' && isAnswerToSender) {
    return { builtIn: 'answer' };
  }
  if (verb === 'read' && sender.kind !== 'account' && sender.kind !== 'installation' && sender.isConnectedPlugin) {
    return { builtIn: 'pluginRead' };
  }
  if (verb === 'read' && sender.kind === 'viewer' && inForce.isViewerReadOn) {
    return { builtIn: 'viewerRead' };
  }
  if (verb === 'manage' && sender.kind === 'installation' && (recipient.kind === 'person' || recipient.isOwnedByPerson)) {
    return { builtIn: 'installation' };
  }
  if (inForce.isOpen) {
    return { builtIn: 'open' };
  }
  const [from, to] = [selectedOf(sender), selectedOf(recipient)];
  const allows = (rule: NetworkRule) => rule.verb === verb && matches(rule.from, { actor: from, otherSide: to }) && matches(rule.to, { actor: to, otherSide: from });
  const index = inForce.rules.findIndex(allows);
  if (index !== -1) {
    return { rule: index };
  }
  for (const { declarer, rules } of inForce.declared) {
    const declaredIndex = rules.findIndex(allows);
    if (declaredIndex !== -1) {
      return { declared: declarer, index: declaredIndex };
    }
  }
  return undefined;
}

/** A built-in rule, one of the fleet's own rules by its place in that list, or a declared rule by its declarer and its place in the declarer's list. */
export type ReachRule = { builtIn: BuiltInRule } | { rule: number } | { declared: LabelOwner; index: number };

/** Whether the rules in force let the sender do the verb to the recipient: some rule does (see reachRuleOf). */
export function allowsReach(inForce: RulesInForce, send: { verb: NetworkVerb; sender: ReachingActor; recipient: ReachingShip; isAnswerToSender: boolean }): boolean {
  return reachRuleOf(inForce, send) !== undefined;
}

/** An actor matches a selector when every term of it holds, combined with AND. */
function matches(selector: readonly SelectorTerm[], sides: { actor: Selected; otherSide: Selected }): boolean {
  return selector.every((term) => holds(term, sides));
}

/**
 * An exact value holds for a ship carrying it; any value for a ship carrying
 * a value of the label; the same value when the ship and the other side carry
 * one value of the label both, each such term on its own (a ship may carry
 * several values of one label, decision 0031). A term of the owner holds for
 * a ship owned by that ship, for a ship with an owner, or for a ship with the
 * same owner as the other side.
 */
function holds(term: SelectorTerm, sides: { actor: Selected; otherSide: Selected }): boolean {
  const { actor: ship, otherSide } = sides;
  if (typeof term === 'string') {
    return ship.labels.some((label) => label.valueId === term);
  }
  if (isOwnerTerm(term)) {
    switch (term.owner) {
      case ANY_LABEL_VALUE:
        return ship.owner !== null;
      case SAME_LABEL_VALUE:
        return ship.owner !== null && ship.owner === otherSide.owner;
      default:
        return ship.owner === term.owner;
    }
  }
  const values = ship.labels.filter((label) => label.labelId === term.labelId);
  switch (term.value) {
    case ANY_LABEL_VALUE:
      return values.length > 0;
    case SAME_LABEL_VALUE:
      return values.some((value) => otherSide.labels.some((other) => other.labelId === term.labelId && other.valueId === value.valueId));
  }
}
