import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { Supplies } from './supplies.js';

export type FollowDeclarations = (fleetId: FleetId, until?: { signal: AbortSignal }) => Promise<Result<{ didSupply: boolean }, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/** The codes with which the fleet says a crew token no longer crews its ship. */
const GONE = new Set(['LEASE_ENDED', 'UNAUTHORIZED']);

/** The event with which a ship declares or withdraws its rules, or is retired with them (decision 0037). */
const DECLARED = 'NetworkRulesDeclared';

/** How long one follow waits for an event: the most the fleet waits. */
const WAIT_SECONDS = 25;

/**
 * Use case: the networking plugin follows a fleet's events once, waiting a
 * while for one, and supplies the fleet again when a ship declared or
 * withdrew its rules, so they are added to argo's at once (decision 0037).
 * The first follow starts where the fleet is now and supplies it, so a rule
 * declared before is in the list. Where it got to is kept in memory: a
 * restart starts again, and every start supplies anyway.
 */
export function createFollowDeclarations(deps: { door: FleetDoor; connections: ConnectionStore; supplies: Pick<Supplies, 'supply'> }): FollowDeclarations {
  const positions = new Map<FleetId, number>();
  return async (fleetId, until) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The networking plugin is not connected to this fleet');
    }
    const afterSeq = positions.get(fleetId);
    const followed = await deps.door.follow(crew.crewToken, { afterSeq, waitSeconds: afterSeq === undefined ? 0 : WAIT_SECONDS, signal: until?.signal });
    if (!followed.isOk) {
      if (GONE.has(followed.error.code)) {
        await deps.connections.drop(fleetId);
        return refuse('NOT_CONNECTED', 'The fleet no longer takes the crew token: connect the networking plugin again');
      }
      return refuse('FLEET_UNAVAILABLE', `The fleet did not let the networking plugin follow it: ${followed.error.message}`);
    }
    positions.set(fleetId, followed.value.lastSeq);
    const isDeclared = afterSeq === undefined || followed.value.types.includes(DECLARED);
    if (isDeclared) {
      await deps.supplies.supply(fleetId);
    }
    return ok({ didSupply: isDeclared });
  };
}
