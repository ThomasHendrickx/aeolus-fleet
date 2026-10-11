import type { FleetId } from '@aeolus-fleet/common';

import type { ManagementCrewStore } from '../management/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { Declarations, NetworkDoor } from './ports.js';

/** Whether this call withdrew from the fleet: false when there was nothing to withdraw or it withdrew already. */
export type WithdrawNetworkRules = (fleetId: FleetId) => Promise<Result<{ isWithdrawn: boolean }, DomainError<'FLEET_UNAVAILABLE'>>>;

/** The codes with which the fleet says the management ship holds no declaration to withdraw: the crew token no longer crews it, or it holds no labels:define. */
const NOTHING_TO_WITHDRAW = new Set(['LEASE_ENDED', 'UNAUTHORIZED', 'FORBIDDEN']);

/**
 * Use case: squadrons withdraws the network rules it declared (decision 0037)
 * when it is switched off for a fleet or the fleet is deleted from it: it
 * declares an empty list. The labels it assigned stay. Not connected, it has
 * nothing to withdraw. Withdrawn once per ship in this process, until it
 * declares again.
 */
export function createWithdrawNetworkRules(deps: { door: NetworkDoor; management: ManagementCrewStore; declarations: Declarations }): WithdrawNetworkRules {
  return async (fleetId) => {
    const crew = await deps.management.find(fleetId);
    if (!crew || deps.declarations.get(crew.shipId) === null) {
      return ok({ isWithdrawn: false });
    }
    const withdrawn = await deps.door.declareNetworkRules(crew.crewToken, { rules: [] });
    if (!withdrawn.isOk && !NOTHING_TO_WITHDRAW.has(withdrawn.error.code)) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not let squadrons withdraw its network rules: ${withdrawn.error.message}`);
    }
    deps.declarations.set(crew.shipId, null);
    return ok({ isWithdrawn: withdrawn.isOk });
  };
}
