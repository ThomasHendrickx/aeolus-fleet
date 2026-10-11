import type { FleetDoor, FleetRefusal, ManagementCrewStore } from '../../core/management/ports.js';
import type { NetworkDoor } from '../../core/network/ports.js';
import type { Result } from '../../core/shared/result.js';

type Watched = <T>(crewToken: string, call: Promise<Result<T, FleetRefusal>>) => Promise<Result<T, FleetRefusal>>;

/** Passes a call's answer on, dropping the fleet's management crew token first when it answers LEASE_ENDED. */
function leaseWatcher(store: ManagementCrewStore): Watched {
  return async (crewToken, call) => {
    const result = await call;
    if (!result.isOk && result.error.code === 'LEASE_ENDED') {
      const released = (await store.connected()).find((crew) => crew.crewToken === crewToken);
      if (released) {
        await store.drop(released.fleetId);
      }
    }
    return result;
  };
}

/**
 * The fleet door, watching each fleet's management ship lease: when a call
 * made with a fleet's management crew token answers LEASE_ENDED, its operator
 * released the ship, so that token is dropped and squadrons is not connected
 * to that fleet until its operator connects it again; other fleets stay
 * connected. Calls with a flagship's token pass untouched.
 */
export function watchManagementLease(door: FleetDoor, store: ManagementCrewStore): FleetDoor {
  const watched = leaseWatcher(store);
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
    pong: (crewToken, deliveryId) => watched(crewToken, door.pong(crewToken, deliveryId)),
    send: (crewToken, message) => watched(crewToken, door.send(crewToken, message)),
  };
}

/** The label and network rule calls, watching each fleet's management ship lease as the fleet door does. */
export function watchNetworkLease(door: NetworkDoor, store: ManagementCrewStore): NetworkDoor {
  const watched = leaseWatcher(store);
  return {
    listLabels: (crewToken) => watched(crewToken, door.listLabels(crewToken)),
    defineLabel: (crewToken, label) => watched(crewToken, door.defineLabel(crewToken, label)),
    changeLabelValues: (crewToken, change) => watched(crewToken, door.changeLabelValues(crewToken, change)),
    listLabelledShips: (crewToken) => watched(crewToken, door.listLabelledShips(crewToken)),
    assignLabel: (crewToken, assignment) => watched(crewToken, door.assignLabel(crewToken, assignment)),
    unassignLabel: (crewToken, assignment) => watched(crewToken, door.unassignLabel(crewToken, assignment)),
    declareNetworkRules: (crewToken, declaration) => watched(crewToken, door.declareNetworkRules(crewToken, declaration)),
  };
}
