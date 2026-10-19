import { REACH_REFUSALS_READ_MAX } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { ok, type Result } from '../shared/result.js';
import type { ReachRefusalRepository } from './ports.js';
import type { ReachRefusal } from './reach-refusal.js';
import { readsShip, type ReadReach, type ReadReachOf } from './read-reach.js';

export type ReadReachRefusals = (caller: Caller) => Promise<Result<ReachRefusal[], never>>;

/** Whether the reader reads the refusal's sender ship or a ship it was for: a sender that is no ship is no ship it reads. */
function readsRefusal(reach: ReadReach, refusal: ReachRefusal): boolean {
  const recipients = refusal.recipient.kind === 'ship' ? [refusal.recipient.ship] : refusal.recipient.ships;
  const ships = refusal.sender.kind === 'ship' ? [refusal.sender, ...recipients] : recipients;
  return ships.some((ship) => readsShip(reach, ship.id));
}

/**
 * Use case: an actor holding fleet:explain reads the sends the fleet's
 * network rules refused, the latest first (decisions 0034, 0053): those whose
 * sender or recipient ship it reads. The scope is checked before this runs.
 */
export function createReadReachRefusals(deps: { reachRefusals: Pick<ReachRefusalRepository, 'latest'>; readReach: ReadReachOf }): ReadReachRefusals {
  return async (caller) => {
    const reach = await deps.readReach(caller);
    const latest = await deps.reachRefusals.latest(caller.fleetId, REACH_REFUSALS_READ_MAX);
    return ok(latest.filter((refusal) => readsRefusal(reach, refusal)));
  };
}
