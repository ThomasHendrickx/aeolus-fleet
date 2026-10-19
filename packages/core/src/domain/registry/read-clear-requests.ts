import { hasScope, type ShipCaller } from '../shared/caller.js';
import type { ClearRequest } from './clear-request.js';
import type { ClearRequestRepository } from './ports.js';
import { readsShip, type ReadReachOf } from './read-reach.js';

/** A pending clear request as it is read: whose, which worktree, who asked and when. */
export type ListedClearRequest = Omit<ClearRequest, 'fleetId'>;

export type ReadClearRequests = (caller: ShipCaller) => Promise<ListedClearRequest[]>;

/**
 * Use case: the pending clear requests (decision 0032). A caller with
 * fleet:read reads every trierarch's for the ships it reads (decision 0034),
 * so the console shows a worktree clearing; a trierarch with crew:run reads
 * its own. One of the two scopes is checked before this runs.
 */
export function createReadClearRequests(deps: { clearRequests: Pick<ClearRequestRepository, 'list' | 'listFor'>; readReach: ReadReachOf }): ReadClearRequests {
  return async (caller) => {
    const reach = hasScope(caller, 'fleet:read') ? await deps.readReach(caller) : undefined;
    const requests = reach
      ? (await deps.clearRequests.list(caller.fleetId)).filter((request) => readsShip(reach, request.shipId))
      : await deps.clearRequests.listFor(caller.fleetId, caller.shipId);
    return requests.map(({ trierarchShipId, shipId, repository, requestedBy, requestedAt }) => ({ trierarchShipId, shipId, repository, requestedBy, requestedAt }));
  };
}
