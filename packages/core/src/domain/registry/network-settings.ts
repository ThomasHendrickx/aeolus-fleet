/**
 * The fleet's network settings (decision 0034): which ships may send to
 * which. A rule says that the ships matching one label selector may send to
 * the ships matching another; allow-only, no deny rules, no precedence. A
 * fleet holds its rules, or none (all-to-all), with a version that moves on
 * every set, so a refusal names the settings that refused it.
 */
import {
  ANY_LABEL_VALUE,
  NETWORK_RULES_MAX,
  SAME_LABEL_VALUE,
  SHIP_LABELS_MAX,
  type FleetId,
  type LabelId,
  type LabelValueId,
  type NetworkPluginDeclaration,
  type SelectorTerm,
  type ShipId,
  type ShipKind,
  type WhileUnavailable,
} from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';

/** The ships for which every term of `from` holds may send to the ships for which every term of `to` holds. */
export interface NetworkRule {
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

export interface NetworkSettings {
  fleetId: FleetId;
  /** The rules every send is checked against; none is all-to-all, an empty list allows only the fixed exceptions. */
  rules: readonly NetworkRule[] | null;
  /** 0 until the fleet first changes its settings; one more on every change. */
  version: number;
  /** The fleet's networking plugin, or none: then the fleet has no rules, and nobody sets them. */
  plugin: NetworkPlugin | null;
}

/** A fleet that never set rules: none, at version 0, without a plugin. */
export function noNetworkSettings(fleetId: FleetId): NetworkSettings {
  return { fleetId, rules: null, version: 0, plugin: null };
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
 * The fleet's plugin goes, and its rules with it: no plugin is all-to-all
 * (decision 0035), at the next version, with NetworkPluginUnregistered. Only
 * the plugin's own ship unregisters it; its retirement does too.
 */
export function unregisterNetworkPlugin(
  current: NetworkSettings,
  change: { shipId: ShipId; at: Date; actor: Actor },
): Result<{ settings: NetworkSettings; events: NewEvent[] }, NotTheNetworkPlugin> {
  if (current.plugin?.shipId !== change.shipId) {
    return refuseNotThePlugin();
  }
  const settings: NetworkSettings = { fleetId: current.fleetId, rules: null, version: current.version + 1, plugin: null };
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
 * version, with NetworkRulesSet. The rules are within the decision's limits:
 * at most 200, each selector at most 20 terms, as a ship carries no more
 * label values, each term once, and a term of the same value on a label on
 * both sides of its rule, as it binds that label there. An id need not
 * exist: an unknown one matches no ship, as in label selection. Only the
 * fleet's registered networking plugin sets them, argo included: rules exist
 * only through a plugin (decision 0035).
 */
export function setNetworkRules(
  current: NetworkSettings,
  change: { rules: readonly NetworkRule[] | null; shipId: ShipId; at: Date; actor: Actor },
): Result<{ settings: NetworkSettings; events: NewEvent[] }, SetNetworkRulesRefusal> {
  const { rules } = change;
  if (current.plugin?.shipId !== change.shipId) {
    return refuseNotThePlugin();
  }
  if (rules !== null) {
    const invalid = invalidRules(rules);
    if (invalid !== undefined) {
      return refuse('INVALID_NETWORK_RULES', `${invalid} (decision 0034)`);
    }
  }
  const settings: NetworkSettings = { ...current, rules: rules?.map(copyOfRule) ?? null, version: current.version + 1 };
  return ok({
    settings,
    events: [
      {
        type: 'NetworkRulesSet',
        fleetId: current.fleetId,
        occurredAt: change.at,
        actor: change.actor,
        details: { version: settings.version, rules: rules?.length ?? null },
      },
    ],
  });
}

/** What breaks the limits, said for the caller, or undefined when the rules keep them. */
function invalidRules(rules: readonly NetworkRule[]): string | undefined {
  if (rules.length > NETWORK_RULES_MAX) {
    return `A fleet holds at most ${String(NETWORK_RULES_MAX)} network rules`;
  }
  for (const rule of rules) {
    const invalid = invalidSelector(rule.from) ?? invalidSelector(rule.to) ?? sameValueOnOneSide(rule);
    if (invalid !== undefined) {
      return invalid;
    }
  }
  return undefined;
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
  return alone === undefined ? undefined : `A term of the same value binds its label on both sides: ${termText({ labelId: alone, value: SAME_LABEL_VALUE })} is on one side only`;
}

/** A term as a refusal names it: an exact value by its id, any other by its label id and symbol. */
function termText(term: SelectorTerm): string {
  return typeof term === 'string' ? term : `${term.labelId}=${term.value}`;
}

function sameValueLabels(selector: readonly SelectorTerm[]): LabelId[] {
  return selector.flatMap((term) => (typeof term !== 'string' && term.value === SAME_LABEL_VALUE ? [term.labelId] : []));
}

function copyOfRule(rule: NetworkRule): NetworkRule {
  return { from: rule.from.map(copyOfTerm), to: rule.to.map(copyOfTerm) };
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

/** The rules a send is checked against, and what the plugin declared when it is the reason. */
export interface RulesInForce {
  rules: readonly NetworkRule[] | null;
  whilePluginUnavailable: Exclude<WhileUnavailable, 'open-all'> | null;
}

/**
 * The rules in force: the settings' own, unless the fleet's networking plugin
 * is not responding. Then what it declared applies: block-all leaves only
 * the fixed exceptions, open-all none (all-to-all), keep-latest the rules it
 * supplied last.
 */
export function rulesInForce(settings: NetworkSettings, isPluginResponding: boolean): RulesInForce {
  const { plugin, rules } = settings;
  if (plugin === null || isPluginResponding) {
    return { rules, whilePluginUnavailable: null };
  }
  switch (plugin.whileUnavailable) {
    case 'block-all':
      return { rules: [], whilePluginUnavailable: 'block-all' };
    case 'open-all':
      return { rules: null, whilePluginUnavailable: null };
    case 'keep-latest':
      return { rules, whilePluginUnavailable: 'keep-latest' };
  }
}

/** A label value a ship carries, with the label it is of, so a term of any or the same value finds it. */
export interface ReachingLabel {
  labelId: LabelId;
  valueId: LabelValueId;
}

/** A ship as a send's check sees it: its kind, for the argo exception, and the label values it carries. */
export interface ReachingShip {
  kind: ShipKind;
  labels: readonly ReachingLabel[];
}

/**
 * Whether the settings let the sender reach the recipient. With no rules,
 * every ship reaches every ship. The fixed exceptions hold whatever the
 * rules: argo reaches every ship and every ship reaches argo, and a ship
 * answers the sender of a message it received. Otherwise a rule must match
 * the sender with its `from` and the recipient with its `to`.
 */
export function allowsReach(settings: Pick<NetworkSettings, 'rules'>, send: { sender: ReachingShip; recipient: ReachingShip; isAnswerToSender: boolean }): boolean {
  const { sender, recipient, isAnswerToSender } = send;
  if (settings.rules === null || sender.kind === 'operator' || recipient.kind === 'operator' || isAnswerToSender) {
    return true;
  }
  return settings.rules.some((rule) => matches(rule.from, { ship: sender, otherSide: recipient }) && matches(rule.to, { ship: recipient, otherSide: sender }));
}

/** A ship matches a selector when every term of it holds, combined with AND. */
function matches(selector: readonly SelectorTerm[], sides: { ship: ReachingShip; otherSide: ReachingShip }): boolean {
  return selector.every((term) => holds(term, sides));
}

/**
 * An exact value holds for a ship carrying it; any value for a ship carrying
 * a value of the label; the same value when the ship and the other side carry
 * one value of the label both, each such term on its own (a ship may carry
 * several values of one label, decision 0031).
 */
function holds(term: SelectorTerm, sides: { ship: ReachingShip; otherSide: ReachingShip }): boolean {
  const { ship, otherSide } = sides;
  if (typeof term === 'string') {
    return ship.labels.some((label) => label.valueId === term);
  }
  const values = ship.labels.filter((label) => label.labelId === term.labelId);
  switch (term.value) {
    case ANY_LABEL_VALUE:
      return values.length > 0;
    case SAME_LABEL_VALUE:
      return values.some((value) => otherSide.labels.some((other) => other.labelId === term.labelId && other.valueId === value.valueId));
  }
}
