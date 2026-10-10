import { isPingContentType, type FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

export type ReceiveOnce = (fleetId: FleetId, until?: { signal: AbortSignal }) => Promise<Result<{ acknowledged: number }, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/** The codes with which the fleet says a crew token no longer crews its ship. */
const GONE = new Set(['LEASE_ENDED', 'UNAUTHORIZED']);

/**
 * Use case: the networking plugin's ship receives once, waiting a while for a
 * delivery, and acknowledges each one on receipt, acting on none: nothing is
 * addressed to it (orchestrator on #260). A ping from argo gets pong instead
 * of ack, as on any ship (blueprint, "Ping"). Its receiving keeps its last seen
 * fresh, so the fleet judges it responding while its process runs (decision
 * 0035). A crew token the fleet no longer takes is dropped.
 */
export function createReceiveOnce(deps: { door: FleetDoor; connections: ConnectionStore }): ReceiveOnce {
  return async (fleetId, until) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The networking plugin is not connected to this fleet');
    }
    const received = await deps.door.receive(crew.crewToken, until);
    if (!received.isOk) {
      if (GONE.has(received.error.code)) {
        await deps.connections.drop(fleetId);
        return refuse('NOT_CONNECTED', 'The fleet no longer takes the crew token: connect the networking plugin again');
      }
      return refuse('FLEET_UNAVAILABLE', `The fleet did not let the networking plugin receive: ${received.error.message}`);
    }
    for (const { deliveryId, contentType } of received.value) {
      const acked = isPingContentType(contentType) ? await deps.door.pong(crew.crewToken, deliveryId) : await deps.door.ack(crew.crewToken, deliveryId);
      if (!acked.isOk) {
        return refuse('FLEET_UNAVAILABLE', `The fleet did not take the acknowledgement: ${acked.error.message}`);
      }
    }
    return ok({ acknowledged: received.value.length });
  };
}
