/**
 * The draft of the fleet's own network rules (decision 0034): one a fleet,
 * a whole list or none for all-to-all, which whoever holds fleet:network
 * edits, explains and compares with the applied rules before applying it.
 * Nothing is checked against it: only an apply puts it in force, so a change
 * of rules is seen before it breaks anything.
 */
import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import { copyOfRule, invalidRules, type InvalidNetworkRules, type NetworkRule, type NetworkSettings } from './network-settings.js';

export interface NetworkRulesDraft {
  fleetId: FleetId;
  /** The rules it would apply; none for all-to-all. */
  rules: readonly NetworkRule[] | null;
  savedAt: Date;
  /** The settings version it was saved at, for the caller to see what it was drafted against. */
  savedAgainstVersion: number;
}

export type NoNetworkRulesDraft = DomainError<'NO_NETWORK_RULES_DRAFT'>;

/** The one refusal of a fleet without a draft. */
export function refuseNoDraft(): Result<never, NoNetworkRulesDraft> {
  return refuse('NO_NETWORK_RULES_DRAFT', 'The fleet has no draft of its network rules');
}

/**
 * The fleet's draft from now on, in place of the one before, against the
 * settings as they are, with NetworkRulesDraftSaved naming how many rules,
 * none for all-to-all. The rules keep the limits an apply would hold them to.
 * Nothing in force changes, so the version stays.
 */
export function saveNetworkRulesDraft(
  settings: NetworkSettings,
  change: { rules: readonly NetworkRule[] | null; at: Date; actor: Actor },
): Result<{ draft: NetworkRulesDraft; events: NewEvent[] }, InvalidNetworkRules> {
  const { rules } = change;
  const invalid = invalidRules(rules);
  if (invalid !== undefined) {
    return refuse('INVALID_NETWORK_RULES', invalid);
  }
  const draft: NetworkRulesDraft = { fleetId: settings.fleetId, rules: rules === null ? null : rules.map(copyOfRule), savedAt: change.at, savedAgainstVersion: settings.version };
  return ok({
    draft,
    events: [
      {
        type: 'NetworkRulesDraftSaved',
        fleetId: settings.fleetId,
        occurredAt: change.at,
        actor: change.actor,
        details: { rules: rules === null ? null : rules.length, savedAgainstVersion: settings.version },
      },
    ],
  });
}

/** The draft goes, with NetworkRulesDraftDiscarded; the applied rules stay as they are. */
export function discardNetworkRulesDraft(
  draft: NetworkRulesDraft | undefined,
  change: { fleetId: FleetId; at: Date; actor: Actor },
): Result<{ events: NewEvent[] }, NoNetworkRulesDraft> {
  if (draft === undefined) {
    return refuseNoDraft();
  }
  return ok({ events: [{ type: 'NetworkRulesDraftDiscarded', fleetId: change.fleetId, occurredAt: change.at, actor: change.actor, details: {} }] });
}
