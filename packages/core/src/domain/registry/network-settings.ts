/**
 * The fleet's network settings (decision 0033): which ships may send to
 * which. A rule says that the ships matching one label selector may send to
 * the ships matching another; allow-only, no deny rules, no precedence. A
 * fleet holds its rules, or none (all-to-all), with a version that moves on
 * every set, so a refusal names the settings that refused it.
 */
import { NETWORK_RULES_MAX, SHIP_LABELS_MAX, type FleetId, type LabelValueId, type ShipKind } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';

/** The ships carrying every one of these label values may send to the ships carrying every one of those. */
export interface NetworkRule {
  from: readonly LabelValueId[];
  to: readonly LabelValueId[];
}

export interface NetworkSettings {
  fleetId: FleetId;
  /** The rules every send is checked against; none is all-to-all, an empty list allows only the fixed exceptions. */
  rules: readonly NetworkRule[] | null;
  /** 0 until the fleet first sets rules; one more on every set. */
  version: number;
}

/** A fleet that never set rules: none, at version 0. */
export function noNetworkSettings(fleetId: FleetId): NetworkSettings {
  return { fleetId, rules: null, version: 0 };
}

export type SetNetworkRulesRefusal = DomainError<'INVALID_NETWORK_RULES'>;

/**
 * The fleet's rules from now on, replacing the ones it had, at the next
 * version, with NetworkRulesSet. The rules are within the decision's limits:
 * at most 200, each selector at most 20 label values, as a ship carries no
 * more, each once. A value id need not exist: an unknown one matches no ship,
 * as in label selection.
 */
export function setNetworkRules(
  current: NetworkSettings,
  change: { rules: readonly NetworkRule[] | null; at: Date; actor: Actor },
): Result<{ settings: NetworkSettings; events: NewEvent[] }, SetNetworkRulesRefusal> {
  const { rules } = change;
  if (rules !== null) {
    const invalid = invalidRules(rules);
    if (invalid !== undefined) {
      return refuse('INVALID_NETWORK_RULES', `${invalid} (decision 0033)`);
    }
  }
  const settings: NetworkSettings = { fleetId: current.fleetId, rules: rules?.map(copyOfRule) ?? null, version: current.version + 1 };
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
  for (const selector of rules.flatMap((rule) => [rule.from, rule.to])) {
    if (selector.length > SHIP_LABELS_MAX) {
      return `A selector holds at most ${String(SHIP_LABELS_MAX)} label values, as a ship carries no more`;
    }
    const twice = selector.find((valueId, index) => selector.indexOf(valueId) !== index);
    if (twice !== undefined) {
      return `A selector names each label value once: ${twice} twice`;
    }
  }
  return undefined;
}

function copyOfRule(rule: NetworkRule): NetworkRule {
  return { from: [...rule.from], to: [...rule.to] };
}

/** A ship as a send's check sees it: its kind, for the argo exception, and the label values it carries. */
export interface ReachingShip {
  kind: ShipKind;
  labels: readonly LabelValueId[];
}

/**
 * Whether the settings let the sender reach the recipient. With no rules,
 * every ship reaches every ship. The fixed exceptions hold whatever the
 * rules: argo reaches every ship and every ship reaches argo, and a ship
 * answers the sender of a message it received. Otherwise a rule must match
 * the sender with its `from` and the recipient with its `to`.
 */
export function allowsReach(settings: NetworkSettings, send: { sender: ReachingShip; recipient: ReachingShip; isAnswerToSender: boolean }): boolean {
  const { sender, recipient, isAnswerToSender } = send;
  if (settings.rules === null || sender.kind === 'operator' || recipient.kind === 'operator' || isAnswerToSender) {
    return true;
  }
  return settings.rules.some((rule) => matches(rule.from, sender) && matches(rule.to, recipient));
}

/** A ship matches a selector when it carries every value in it: exact matches, combined with AND. */
function matches(selector: readonly LabelValueId[], ship: ReachingShip): boolean {
  return selector.every((valueId) => ship.labels.includes(valueId));
}
