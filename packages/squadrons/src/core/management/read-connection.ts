import type { ConnectionStatus, FleetDoor, ManagementCrewStore } from './ports.js';

export type ReadConnection = () => Promise<ConnectionStatus>;

/** The codes with which the fleet says a crew token no longer crews its ship. */
const GONE = new Set(['LEASE_ENDED', 'UNAUTHORIZED']);

/**
 * Use case: whether squadrons is connected. Its kept crew token is asked who
 * it is: a token the fleet no longer takes (the ship was released, its session
 * ended) is dropped, and squadrons is not connected until the operator
 * connects it again. When the fleet does not answer, the token is kept.
 */
export function createReadConnection(deps: { door: FleetDoor; store: ManagementCrewStore }): ReadConnection {
  return async () => {
    const crew = await deps.store.find();
    if (crew) {
      const who = await deps.door.whoami(crew.crewToken);
      if (who.isOk || !GONE.has(who.error.code)) {
        return { state: 'connected', ship: { shipId: crew.shipId, name: who.isOk ? who.value.name : crew.name }, lastShipId: crew.shipId };
      }
      await deps.store.drop();
    }
    const binding = await deps.store.binding();
    return { state: 'not-connected', ship: null, lastShipId: binding?.shipId ?? null };
  };
}
