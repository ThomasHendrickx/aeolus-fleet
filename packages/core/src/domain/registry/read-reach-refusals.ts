import { PAGE_SIZE_DEFAULT, type ReachRefusalId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Page } from '../shared/page.js';
import { ok, type Result } from '../shared/result.js';
import type { ReachRefusalRepository } from './ports.js';
import type { ReachRefusal } from './reach-refusal.js';
import { readsShip, type ReadReach, type ReadReachOf } from './read-reach.js';

export type ReadReachRefusals = (caller: Caller, input: { cursor?: ReachRefusalId; limit?: number }) => Promise<Result<Page<ReachRefusal, ReachRefusalId>, never>>;

/** Whether the reader reads the refusal's sender ship or a ship it was for: a sender that is no ship is no ship it reads. */
function readsRefusal(reach: ReadReach, refusal: ReachRefusal): boolean {
  const recipients = refusal.recipient.kind === 'ship' ? [refusal.recipient.ship] : refusal.recipient.ships;
  const ships = refusal.sender.kind === 'ship' ? [refusal.sender, ...recipients] : recipients;
  return ships.some((ship) => readsShip(reach, ship.id));
}

/**
 * Use case: an actor holding fleet:explain reads a page of the sends the
 * fleet's network rules refused, the latest first (decisions 0034, 0053): those whose
 * sender or recipient ship it reads. The scope is checked before this runs.
 */
export function createReadReachRefusals(deps: { reachRefusals: Pick<ReachRefusalRepository, 'latest'>; readReach: ReadReachOf }): ReadReachRefusals {
  return async (caller, { cursor, limit = PAGE_SIZE_DEFAULT }) => {
    const [reach, latest] = await Promise.all([deps.readReach(caller), deps.reachRefusals.latest(caller.fleetId, { cursor, limit })]);
    return ok({ items: latest.items.filter((refusal) => readsRefusal(reach, refusal)), nextCursor: latest.nextCursor });
  };
}
