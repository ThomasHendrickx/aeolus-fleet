import type { FleetDoor, FleetRefusal, ManagementCrewStore } from '../../core/management/ports.js';
import type { Result } from '../../core/shared/result.js';

/**
 * The fleet door, watching the management ship's lease: when a call made with
 * squadrons' management crew token answers LEASE_ENDED, the operator released
 * the ship, so the token is dropped and squadrons is not connected until the
 * operator connects it again. Calls with a flagship's token pass untouched.
 */
export function watchManagementLease(door: FleetDoor, store: ManagementCrewStore): FleetDoor {
  const watched = async <T>(crewToken: string, call: Promise<Result<T, FleetRefusal>>): Promise<Result<T, FleetRefusal>> => {
    const result = await call;
    if (!result.isOk && result.error.code === 'LEASE_ENDED' && (await store.find())?.crewToken === crewToken) {
      await store.drop();
    }
    return result;
  };
  return {
    register: (claim) => door.register(claim),
    whoami: (crewToken) => watched(crewToken, door.whoami(crewToken)),
    commission: (crewToken, ship) => watched(crewToken, door.commission(crewToken, ship)),
    getShip: (crewToken, ship) => watched(crewToken, door.getShip(crewToken, ship)),
    release: (crewToken, ship) => watched(crewToken, door.release(crewToken, ship)),
    deregister: (crewToken) => watched(crewToken, door.deregister(crewToken)),
    getStartingPrompt: (crewToken, ship) => watched(crewToken, door.getStartingPrompt(crewToken, ship)),
    listShips: (crewToken) => watched(crewToken, door.listShips(crewToken)),
    retire: (crewToken, ship) => watched(crewToken, door.retire(crewToken, ship)),
    receive: (crewToken, until) => watched(crewToken, door.receive(crewToken, until)),
    ack: (crewToken, deliveryId) => watched(crewToken, door.ack(crewToken, deliveryId)),
    send: (crewToken, message) => watched(crewToken, door.send(crewToken, message)),
  };
}
