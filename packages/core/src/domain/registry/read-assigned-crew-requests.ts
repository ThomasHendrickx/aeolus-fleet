import type { Caller } from '../shared/caller.js';
import type { CrewRequest } from './crew-request.js';
import type { CrewRequestRepository } from './ports.js';

/** A crew request as its trierarch reads it: which ship, with what settings, how it stands, and whether its crew is final. */
export type AssignedCrewRequest = Pick<CrewRequest, 'shipId' | 'settings' | 'settingsVersion' | 'requestedAt' | 'status' | 'isFinal'>;

export type ReadAssignedCrewRequests = (caller: Caller) => Promise<AssignedCrewRequest[]>;

/**
 * Use case: a trierarch reads the crew requests assigned to its ship, oldest
 * ship first: its ships are this query, never a list kept on its ship
 * (decision 0029). Its scope (crew:run) is checked before this runs.
 */
export function createReadAssignedCrewRequests(deps: { crewRequests: Pick<CrewRequestRepository, 'listAssignedTo'> }): ReadAssignedCrewRequests {
  return async (caller) =>
    (await deps.crewRequests.listAssignedTo(caller.fleetId, caller.shipId)).map(({ shipId, settings, settingsVersion, requestedAt, status, isFinal }) => ({
      shipId,
      settings,
      settingsVersion,
      requestedAt,
      status,
      isFinal,
    }));
}
