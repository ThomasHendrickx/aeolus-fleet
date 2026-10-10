import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { FleetForgetter, InstallationRequests, RequestHasher } from './ports.js';
import { earlierAnswer } from './request-id.js';

export type DeleteFleet = (input: { requestId: string; fleetId: FleetId }) => Promise<Result<Record<string, never>, DomainError<'REQUEST_ID_USED' | 'FLEET_UNAVAILABLE'>>>;

/** The codes with which the fleet says nothing is left to unregister: the crew token no longer crews its ship, or its ship is not the plugin. */
const NOTHING_TO_UNREGISTER = new Set(['LEASE_ENDED', 'UNAUTHORIZED', 'FORBIDDEN']);

/**
 * Use case: the hosting service deletes a fleet from the networking plugin
 * (decisions 0021, 0035): it unregisters from the fleet first, its rules
 * going with it, then forgets everything it holds of the fleet. A fleet must
 * never be left with a plugin nobody can unregister, so while the fleet does
 * not answer the delete is refused and forgets nothing, for the hosting
 * service to retry. The request is kept as its hash only, so nothing of the
 * fleet stays; a replay answers the first answer.
 */
export function createDeleteFleet(deps: {
  forgetter: FleetForgetter;
  requests: InstallationRequests;
  hasher: RequestHasher;
  clock: Clock;
  door: FleetDoor;
  connections: ConnectionStore;
}): DeleteFleet {
  return async ({ requestId, fleetId }) => {
    const requestHash = deps.hasher.hash(`deleteFleet ${fleetId}`);
    const earlier = await earlierAnswer(deps.requests, { requestId, requestHash });
    if (earlier !== undefined) {
      return 'isOk' in earlier ? earlier : ok({});
    }
    const crew = await deps.connections.find(fleetId);
    if (crew) {
      const unregistered = await deps.door.unregisterNetworkPlugin(crew.crewToken);
      if (!unregistered.isOk && !NOTHING_TO_UNREGISTER.has(unregistered.error.code)) {
        return refuse('FLEET_UNAVAILABLE', `The fleet did not let the networking plugin unregister: ${unregistered.error.message}`);
      }
    }
    await deps.forgetter.forget(fleetId);
    await deps.requests.record({ requestId, kind: 'deleteFleet', requestHash, fleetId: null, isEnabled: null, at: deps.clock.now() });
    return ok({});
  };
}
