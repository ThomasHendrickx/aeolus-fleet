import type { FleetId, NetworkRule } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { networkOf } from './declaration.js';
import type { FleetNetworks } from './ports.js';
import { brokenRuleLimit } from './rule-limits.js';
import type { Supplies, SupplyState } from './supplies.js';

export type SaveRules = (input: { fleetId: FleetId; rules: readonly NetworkRule[] | null }) => Promise<
  Result<{ rules: readonly NetworkRule[] | null; supply: SupplyState }, DomainError<'INVALID_NETWORK_RULES'>>
>;

/**
 * Use case: argo saves the fleet's rules in the networking plugin's editor:
 * the whole list, or none for all-to-all. The plugin keeps them with argo's
 * declaration and supplies them to the fleet at once (Thomas on #260); while
 * the fleet does not answer they wait, kept, for a retry. Rules over decision
 * 0034's limits are refused and nothing is kept.
 */
export function createSaveRules(deps: { networks: FleetNetworks; supplies: Supplies }): SaveRules {
  return async ({ fleetId, rules }) => {
    const broken = rules === null ? undefined : brokenRuleLimit(rules);
    if (broken !== undefined) {
      return refuse('INVALID_NETWORK_RULES', `${broken} (decision 0034)`);
    }
    const { declaration } = networkOf(await deps.networks.find(fleetId));
    await deps.networks.save(fleetId, { rules, declaration });
    return ok({ rules, supply: await deps.supplies.supply(fleetId) });
  };
}
