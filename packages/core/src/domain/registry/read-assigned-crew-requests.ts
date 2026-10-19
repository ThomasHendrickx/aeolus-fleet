import type { ShipId } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import type { CrewRequest } from './crew-request.js';
import type { CrewRequestRepository, ShipRepository } from './ports.js';

/**
 * A crew request as its trierarch reads it: which ship, with what settings,
 * how it stands, whether its crew is final, and the ship's owner as it is
 * now, by id and name, where its trouble goes (decision 0045).
 */
export type AssignedCrewRequest = Pick<CrewRequest, 'shipId' | 'settings' | 'settingsVersion' | 'requestedAt' | 'status' | 'isFinal'> & { ownerShipId: ShipId | null; ownerName: string | null };

export type ReadAssignedCrewRequests = (caller: ShipCaller) => Promise<AssignedCrewRequest[]>;

/**
 * Use case: a trierarch reads the crew requests assigned to its ship, oldest
 * ship first: its ships are this query, never a list kept on its ship
 * (decision 0029). Its scope (crew:run) is checked before this runs.
 */
export function createReadAssignedCrewRequests(deps: { crewRequests: Pick<CrewRequestRepository, 'listAssignedTo'>; ships: Pick<ShipRepository, 'find'> }): ReadAssignedCrewRequests {
  return async (caller) => {
    const requests = await deps.crewRequests.listAssignedTo(caller.fleetId, caller.shipId);
    return Promise.all(
      requests.map(async ({ shipId, settings, settingsVersion, requestedAt, status, isFinal }) => {
        const ownerShipId = (await deps.ships.find(caller.fleetId, shipId))?.owner ?? null;
        const owner = ownerShipId === null ? undefined : await deps.ships.find(caller.fleetId, ownerShipId);
        return { shipId, settings, settingsVersion, requestedAt, status, isFinal, ownerShipId: owner?.id ?? null, ownerName: owner?.name ?? null };
      }),
    );
  };
}
