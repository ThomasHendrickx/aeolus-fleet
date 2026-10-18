/**
 * The fleet's network settings (decision 0034): which ships may send to,
 * read or manage which. A rule names its verb and says that the ships
 * matching one selector may do it to the ships matching another; allow-only,
 * no deny rules, no precedence. Beside its rules a fleet holds the switches
 * of the built-in rules that can be off, with a version that moves on every
 * change, so a refusal names the settings that refused it.
 */
import {
  ANY_LABEL_VALUE,
  NETWORK_RULES_MAX,
  NETWORK_VERBS,
  SAME_LABEL_VALUE,
  SHIP_LABELS_MAX,
  isOwnerTerm,
  type FleetId,
  type LabelId,
  type LabelValueId,
  type BuiltInRule,
  type NetworkPluginDeclaration,
  type NetworkVerb,
  type SelectorTerm,
  type SetBuiltInRuleInput,
  type ShipId,
  type ShipKind,
  type WhileUnavailable,
} from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';

/** The ships for which every term of `from` holds may do its verb to the ships for which every term of `to` holds. */
export interface NetworkRule {
  verb: NetworkVerb;
  from: readonly SelectorTerm[];
  to: readonly SelectorTerm[];
}

/**
 * The fleet's networking plugin (decision 0035): the ship that alone sets the
 * rules while registered, with what it declared for while it is unavailable.
 */
export interface NetworkPlugin extends NetworkPluginDeclaration {
  shipId: ShipId;
}

/**
 * The built-in rules that can be off (decision 0034): the viewer reading
 * every ship, argo's to switch, and open, every ship to every ship, one per
 * verb, the networking plugin's to switch. A fleet starts with all on.
 */
export interface BuiltInSwitches {
  isViewerReadOn: boolean;
  open: Readonly<Record<NetworkVerb, boolean>>;
}

export interface NetworkSettings {
  fleetId: FleetId;
  /** The rules beside the built-in ones, the networking plugin's (decision 0035); none allows only the built-in rules. */
  rules: readonly NetworkRule[];
  builtIns: BuiltInSwitches;
  /** 0 until the fleet first changes its settings; one more on every change. */
  version: number;
  /** The fleet's networking plugin, or none: then the fleet has no rules, and nobody sets them. */
  plugin: NetworkPlugin | null;
}

/** Every built-in rule on: what a fleet starts with, and what no networking plugin leaves. */
export const BUILT_INS_ON: BuiltInSwitches = { isViewerReadOn: true, open: { send: true, read: true, manage: true } };

/** A fleet that never set rules: none, every built-in rule on, at version 0, without a plugin. */
export function noNetworkSettings(fleetId: FleetId): NetworkSettings {
  return { fleetId, rules: [], builtIns: BUILT_INS_ON, version: 0, plugin: null };
}

export type NotTheNetworkPlugin = DomainError<'NOT_THE_NETWORK_PLUGIN'>;

export type SetNetworkRulesRefusal = DomainError<'INVALID_NETWORK_RULES'> | NotTheNetworkPlugin;

export type RegisterNetworkPluginRefusal = DomainError<'NETWORK_PLUGIN_REGISTERED'>;

function refuseNotThePlugin() {
  return refuse('NOT_THE_NETWORK_PLUGIN', "Only the fleet's networking plugin does this (decision 0035)");
}

/**
 * The ship becomes the fleet's networking plugin, with what it declared, at
 * the next version, with NetworkPluginRegistered. A fleet without a plugin
 * has no rules, so the plugin starts from none until it supplies its own. The plugin may register again, replacing what it
 * declared; another ship is refused until it unregisters: one owner of the
 * rules, as a label has one.
 */
export function registerNetworkPlugin(
  current: NetworkSettings,
  change: { shipId: ShipId; declaration: NetworkPluginDeclaration; at: Date; actor: Actor },
): Result<{ settings: NetworkSettings; events: NewEvent[] }, RegisterNetworkPluginRefusal> {
  const { shipId, declaration } = change;
  if (current.plugin !== null && current.plugin.shipId !== shipId) {
    return refuse('NETWORK_PLUGIN_REGISTERED', 'The fleet already has a networking plugin; it unregisters first (decision 0035)');
  }
  const settings: NetworkSettings = {
    ...current,
    version: current.version + 1,
    plugin: { shipId, whileUnavailable: declaration.whileUnavailable, notRespondingAfterSeconds: declaration.notRespondingAfterSeconds },
  };
  return ok({
    settings,
    events: [
      {
        type: 'NetworkPluginRegistered',
        fleetId: current.fleetId,
        occurredAt: change.at,
        actor: change.actor,
        shipId,
        details: { version: settings.version, whileUnavailable: declaration.whileUnavailable, notRespondingAfterSeconds: declaration.notRespondingAfterSeconds },
      },
    ],
  });
}

/**
 * The fleet's plugin goes, and its rules with it, and the open rules are on
 * again: no plugin is all-to-all (decision 0035), at the next version, with
 * NetworkPluginUnregistered. The viewer reading stays as argo set it. Only
 * the plugin's own ship unregisters it; its retirement does too.
 */
export function unregisterNetworkPlugin(
  current: NetworkSettings,
  change: { shipId: ShipId; at: Date; actor: Actor },
): Result<{ settings: NetworkSettings; events: NewEvent[] }, NotTheNetworkPlugin> {
  if (current.plugin?.shipId !== change.shipId) {
    return refuseNotThePlugin();
  }
  const settings: NetworkSettings = { fleetId: current.fleetId, rules: [], builtIns: { ...current.builtIns, open: BUILT_INS_ON.open }, version: current.version + 1, plugin: null };
  return ok({
    settings,
    events: [
      {
        type: 'NetworkPluginUnregistered',
        fleetId: current.fleetId,
        occurredAt: change.at,
        actor: change.actor,
        shipId: change.shipId,
        details: { version: settings.version },
      },
    ],
  });
}

/**
 * The fleet's rules from now on, replacing the ones it had, at the next
 * version, with NetworkRulesSet. The rules are within the decisions' limits:
 * at most 200 of argo's plus every rule the fleet's ships declared, which the
 * plugin adds to argo's when it supplies them (decision 0037); each selector
 * at most 20 terms, as a ship carries no more label values, each term once, and a term of the same value on a label on
 * both sides of its rule, as it binds that label there. An id need not
 * exist: an unknown one matches no ship, as in label selection. Only the
 * fleet's registered networking plugin sets them, argo included: rules exist
 * only through a plugin (decision 0035).
 */
export function setNetworkRules(
  current: NetworkSettings,
  change: { rules: readonly NetworkRule[]; declaredRules: number; shipId: ShipId; at: Date; actor: Actor },
): Result<{ settings: NetworkSettings; events: NewEvent[] }, SetNetworkRulesRefusal> {
  const { rules, declaredRules } = change;
  if (current.plugin?.shipId !== change.shipId) {
    return refuseNotThePlugin();
  }
  if (rules.length > NETWORK_RULES_MAX + declaredRules) {
    return refuse(
      'INVALID_NETWORK_RULES',
      `A fleet holds at most ${String(NETWORK_RULES_MAX)} network rules of argo's plus the ${String(declaredRules)} its ships declared (decision 0037)`,
    );
  }
  const invalid = rules.map(invalidRule).find((broken) => broken !== undefined);
  if (invalid !== undefined) {
    return refuse('INVALID_NETWORK_RULES', `${invalid} (decision 0034)`);
  }
  const settings: NetworkSettings = { ...current, rules: rules.map(copyOfRule), version: current.version + 1 };
  return ok({
    settings,
    events: [
      {
        type: 'NetworkRulesSet',
        fleetId: current.fleetId,
        occurredAt: change.at,
        actor: change.actor,
        details: { version: settings.version, rules: rules.length },
      },
    ],
  });
}

export type SetBuiltInRuleRefusal = DomainError<'BUILT_IN_RULE_FIXED' | 'NOT_THE_OPERATOR_SHIP'> | NotTheNetworkPlugin;

/**
 * A built-in rule turned on or off, as its own action (decision 0034): the
 * viewer reading by argo, open for one verb by the fleet's networking plugin.
 * argo, the owner and the answer are never off, so turning them is refused.
 * A change moves the version and writes BuiltInRuleChanged; a rule already
 * as asked changes nothing.
 */
export function setBuiltInRule(
  current: NetworkSettings,
  change: { input: SetBuiltInRuleInput; caller: { shipId: ShipId; isOperator: boolean }; at: Date; actor: Actor },
): Result<{ settings: NetworkSettings; events: NewEvent[] }, SetBuiltInRuleRefusal> {
  const { input, caller } = change;
  if (input.rule === 'argo' || input.rule === 'owner' || input.rule === 'answer') {
    return refuse('BUILT_IN_RULE_FIXED', `The built-in rule ${input.rule} is never off (decision 0034)`);
  }
  if (input.rule === 'viewerRead' && !caller.isOperator) {
    return refuse('NOT_THE_OPERATOR_SHIP', 'Only argo turns the viewer reading on or off (decision 0034)');
  }
  if (input.rule === 'open' && current.plugin?.shipId !== caller.shipId) {
    return refuseNotThePlugin();
  }
  // The input names a verb for open and for open only (common's schema).
  const { verb } = input;
  const builtIns: BuiltInSwitches =
    input.rule === 'viewerRead' || verb === undefined
      ? { ...current.builtIns, isViewerReadOn: input.rule === 'viewerRead' ? input.isOn : current.builtIns.isViewerReadOn }
      : { ...current.builtIns, open: { ...current.builtIns.open, [verb]: input.isOn } };
  if (builtIns.isViewerReadOn === current.builtIns.isViewerReadOn && NETWORK_VERBS.every((verb) => builtIns.open[verb] === current.builtIns.open[verb])) {
    return ok({ settings: current, events: [] });
  }
  const settings: NetworkSettings = { ...current, builtIns, version: current.version + 1 };
  return ok({
    settings,
    events: [
      {
        type: 'BuiltInRuleChanged',
        fleetId: current.fleetId,
        occurredAt: change.at,
        actor: change.actor,
        details: { rule: input.rule, ...(verb === undefined ? {} : { verb }), isOn: input.isOn, version: settings.version },
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

const MILLISECONDS_PER_SECOND = 1000;

/**
 * Whether the plugin responds at `now` (decision 0035): its ship holds a
 * lease whose crew called the fleet no longer ago than it declared. Its last
 * call is the lease's last seen; nothing else acts on it, and nothing here
 * ends the lease.
 */
export function isNetworkPluginResponding(plugin: NetworkPlugin, crew: { lastSeenAt: Date | undefined; now: Date }): boolean {
  const { lastSeenAt, now } = crew;
  return lastSeenAt !== undefined && now.getTime() - lastSeenAt.getTime() <= plugin.notRespondingAfterSeconds * MILLISECONDS_PER_SECOND;
}

/** The rules and built-in switches a send is checked against, and what the plugin declared when it is the reason. */
export interface RulesInForce {
  rules: readonly NetworkRule[];
  builtIns: BuiltInSwitches;
  whilePluginUnavailable: Exclude<WhileUnavailable, 'open-all'> | null;
}

/**
 * The rules in force: the settings' own, unless the fleet's networking plugin
 * is not responding. Then what it declared applies: block-all leaves only
 * the built-in rules that are never off and the viewer reading, open-all
 * open on for every verb (all-to-all), keep-latest the rules and switches it
 * left last.
 */
export function rulesInForce(settings: NetworkSettings, isPluginResponding: boolean): RulesInForce {
  const { plugin, rules, builtIns } = settings;
  if (plugin === null || isPluginResponding) {
    return { rules, builtIns, whilePluginUnavailable: null };
  }
  switch (plugin.whileUnavailable) {
    case 'block-all':
      return { rules: [], builtIns: { ...builtIns, open: { send: false, read: false, manage: false } }, whilePluginUnavailable: 'block-all' };
    case 'open-all':
      return { rules, builtIns: { ...builtIns, open: BUILT_INS_ON.open }, whilePluginUnavailable: null };
    case 'keep-latest':
      return { rules, builtIns, whilePluginUnavailable: 'keep-latest' };
  }
}

/** A label value a ship carries, with the label it is of, so a term of any or the same value finds it. */
export interface ReachingLabel {
  labelId: LabelId;
  valueId: LabelValueId;
}

/** A ship as a send's check sees it: its id and owner, for the owner exception, its kind, for the argo exception, and the label values it carries. */
export interface ReachingShip {
  id: ShipId;
  owner: ShipId | null;
  kind: ShipKind;
  labels: readonly ReachingLabel[];
}

/**
 * The rule that lets the sender do the verb to the recipient, or undefined
 * when none does. The built-in rules that are never off hold whatever the
 * rules: argo reaches every ship and every ship reaches argo, an owner's ship
 * reaches the ships it owns (decision 0045), and a ship answers the sender of
 * a message it received. The viewer reads every ship while that is on, and
 * every ship reaches every ship by a verb while open is on for it. Otherwise
 * a rule of the verb must match the sender with its `from` and the recipient
 * with its `to`, named by its place in the list. The built-in rules come
 * first, in that order, as the rule list shows them.
 */
export function reachRuleOf(
  settings: Pick<RulesInForce, 'rules' | 'builtIns'>,
  send: { verb: NetworkVerb; sender: ReachingShip; recipient: ReachingShip; isAnswerToSender: boolean },
): ReachRule | undefined {
  const { verb, sender, recipient, isAnswerToSender } = send;
  const { rules, builtIns } = settings;
  if (sender.kind === 'operator' || recipient.kind === 'operator') {
    return { builtIn: 'argo' };
  }
  if (recipient.owner === sender.id) {
    return { builtIn: 'owner' };
  }
  if (verb === 'send' && isAnswerToSender) {
    return { builtIn: 'answer' };
  }
  if (verb === 'read' && sender.kind === 'viewer' && builtIns.isViewerReadOn) {
    return { builtIn: 'viewerRead' };
  }
  if (builtIns.open[verb]) {
    return { builtIn: 'open' };
  }
  const index = rules.findIndex(
    (rule) => rule.verb === verb && matches(rule.from, { ship: sender, otherSide: recipient }) && matches(rule.to, { ship: recipient, otherSide: sender }),
  );
  return index === -1 ? undefined : { index };
}

/** A built-in rule, or one of the settings' rules by its place in the list. */
export type ReachRule = { builtIn: BuiltInRule } | { index: number };

/** Whether the settings let the sender do the verb to the recipient: some rule does (see reachRuleOf). */
export function allowsReach(
  settings: Pick<RulesInForce, 'rules' | 'builtIns'>,
  send: { verb: NetworkVerb; sender: ReachingShip; recipient: ReachingShip; isAnswerToSender: boolean },
): boolean {
  return reachRuleOf(settings, send) !== undefined;
}

/** A ship matches a selector when every term of it holds, combined with AND. */
function matches(selector: readonly SelectorTerm[], sides: { ship: ReachingShip; otherSide: ReachingShip }): boolean {
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
function holds(term: SelectorTerm, sides: { ship: ReachingShip; otherSide: ReachingShip }): boolean {
  const { ship, otherSide } = sides;
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
