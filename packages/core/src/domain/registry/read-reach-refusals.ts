import { REACH_REFUSALS_READ_MAX } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ReachRefusalRepository } from './ports.js';
import type { ReachRefusal } from './reach-refusal.js';

export type ReadReachRefusals = (caller: Caller) => Promise<Result<ReachRefusal[], DomainError<'NOT_THE_OPERATOR_SHIP'>>>;

/**
 * Use case: argo reads the sends the fleet's network rules refused, the
 * latest first (decision 0034). Only argo: a ship that sets the rules does
 * not read who tried to reach whom.
 */
export function createReadReachRefusals(deps: { reachRefusals: Pick<ReachRefusalRepository, 'latest'> }): ReadReachRefusals {
  return async (caller) => {
    if (caller.kind !== 'operator') {
      return refuse('NOT_THE_OPERATOR_SHIP', 'Only argo reads the reach refusals');
    }
    return ok(await deps.reachRefusals.latest(caller.fleetId, REACH_REFUSALS_READ_MAX));
  };
}
