/**
 * The fleet's network settings (decision 0033): which ships may send to
 * which. A rule says that the ships matching one label selector may send to
 * the ships matching another; allow-only, no deny rules, no precedence. A
 * fleet holds its rules, or none (all-to-all), with a version that moves on
 * every set, so a refusal names the settings that refused it.
 */
import { NETWORK_RULES_MAX, SHIP_LABELS_MAX, type FleetId, type LabelValueId } from '@aeolus-fleet/common';

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
