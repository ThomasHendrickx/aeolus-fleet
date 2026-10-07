import { hasScope, type Caller } from '../shared/caller.js';
import type { ClearRequest } from './clear-request.js';
import type { ClearRequestRepository } from './ports.js';

/** A pending clear request as it is read: whose, which worktree, who asked and when. */
export type ListedClearRequest = Omit<ClearRequest, 'fleetId'>;

export type ReadClearRequests = (caller: Caller) => Promise<ListedClearRequest[]>;

/**
 * Use case: the pending clear requests (decision 0032). A caller with
 * fleet:read reads every trierarch's, so the console shows a worktree
 * clearing; a trierarch with crew:run reads its own. One of the two scopes is
 * checked before this runs.
 */
export function createReadClearRequests(deps: { clearRequests: Pick<ClearRequestRepository, 'list' | 'listFor'> }): ReadClearRequests {
  return async (caller) => {
    const requests = hasScope(caller, 'fleet:read')
      ? await deps.clearRequests.list(caller.fleetId)
      : await deps.clearRequests.listFor(caller.fleetId, caller.shipId);
    return requests.map(({ trierarchShipId, shipId, repository, requestedBy, requestedAt }) => ({ trierarchShipId, shipId, repository, requestedBy, requestedAt }));
  };
}
