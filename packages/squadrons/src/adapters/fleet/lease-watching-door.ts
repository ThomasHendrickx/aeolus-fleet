import type { FleetDoor, FleetRefusal, ManagementCrewStore } from '../../core/management/ports.js';
import type { Result } from '../../core/shared/result.js';

/**
 * The fleet door, watching each fleet's management ship lease: when a call
 * made with a fleet's management crew token answers LEASE_ENDED, its operator
 * released the ship, so that token is dropped and squadrons is not connected
 * to that fleet until its operator connects it again; other fleets stay
 * connected. Calls with a flagship's token pass untouched.
 */
export function watchManagementLease(door: FleetDoor, store: ManagementCrewStore): FleetDoor {
  const watched = async <T>(crewToken: string, call: Promise<Result<T, FleetRefusal>>): Promise<Result<T, FleetRefusal>> => {
    const result = await call;
    if (!result.isOk && result.error.code === 'LEASE_ENDED') {
      const released = (await store.connected()).find((crew) => crew.crewToken === crewToken);
      if (released) {
        await store.drop(released.fleetId);
      }
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
    requestCrew: (crewToken, request) => watched(crewToken, door.requestCrew(crewToken, request)),
    removeCrewRequest: (crewToken, ship) => watched(crewToken, door.removeCrewRequest(crewToken, ship)),
    findLabelValue: (crewToken, label) => watched(crewToken, door.findLabelValue(crewToken, label)),
    receive: (crewToken, until) => watched(crewToken, door.receive(crewToken, until)),
    ack: (crewToken, deliveryId) => watched(crewToken, door.ack(crewToken, deliveryId)),
    send: (crewToken, message) => watched(crewToken, door.send(crewToken, message)),
  };
}
