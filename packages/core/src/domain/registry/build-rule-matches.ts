/**
 * Use case: build every fleet's rule matches (design rule-matches.md, Q3
 * rollout A): the release step after the migrations and before core serves,
 * so no read ever meets unbuilt matches and no readiness state is needed.
 * One unit of work per fleet, holding its network settings exclusively, so
 * no rule, label or owner writer runs halfway through it; other fleets are
 * not held. Every row is recomputed from the authoritative tables, so a run
 * after a partial or stale one repairs it and a second run changes nothing.
 */
import type { FleetId } from '@aeolus-fleet/common';

import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { keepEveryRuleMatch, type KeepRuleMatchesTx } from './keep-rule-matches.js';
import type { FleetRepository, NetworkSettingsRepository, RuleMatchRepository } from './ports.js';

export interface BuildRuleMatchesTx extends Omit<KeepRuleMatchesTx, 'networkSettings' | 'ruleMatches'> {
  fleets: Pick<FleetRepository, 'list'>;
  networkSettings: Pick<NetworkSettingsRepository, 'findForShare' | 'findForUpdate'>;
  ruleMatches: KeepRuleMatchesTx['ruleMatches'] & Pick<RuleMatchRepository, 'list'>;
}

export type BuildRuleMatches = () => Promise<Result<{ fleets: number }, never>>;

export function createBuildRuleMatches(deps: { uow: UnitOfWork<BuildRuleMatchesTx> }): BuildRuleMatches {
  return async () => {
    const listed = await deps.uow.run(async (tx) => ok((await tx.fleets.list()).map(({ id }) => id)));
    const fleetIds: readonly FleetId[] = listed.isOk ? listed.value : [];
    for (const fleetId of fleetIds) {
      await deps.uow.run(async (tx) => {
        await tx.networkSettings.findForUpdate(fleetId);
        await keepEveryRuleMatch(tx, fleetId);
        return ok(undefined);
      });
    }
    return ok({ fleets: fleetIds.length });
  };
}
