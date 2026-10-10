import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor, FleetRefusal } from '../connection/ports.js';
import type { IsServed } from '../installation/served.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { networkOf } from './declaration.js';
import type { FleetNetworks } from './ports.js';

/** What supplying a fleet did: registered and supplied the rules, unregistered, or nothing, as it is not connected. */
export type SupplyOutcome = 'supplied' | 'unregistered' | 'not-connected';

export type SupplyFleet = (fleetId: FleetId) => Promise<Result<SupplyOutcome, DomainError<'FLEET_UNAVAILABLE'>>>;

/** The codes with which the fleet says a crew token no longer crews its ship. */
const GONE = new Set(['LEASE_ENDED', 'UNAUTHORIZED']);

/** The code with which the fleet refuses a ship that is not its networking plugin (decision 0035). */
const NOT_THE_PLUGIN = 'FORBIDDEN';

/**
 * Use case: brings a fleet in line with what the networking plugin holds of
 * it (decision 0035, Thomas on #260). Served (switched on), it registers with
 * what argo declared, then supplies the whole list argo saved, none for
 * all-to-all. Not served (switched off), it unregisters, taking the rules from
 * the fleet and keeping its own for when it is on again; a fleet that says its
 * ship is not the plugin is unregistered already. A refusal leaves the fleet
 * to be supplied again later; a crew token the fleet no longer takes is
 * dropped, and the fleet waits for argo to connect it again.
 */
export function createSupplyFleet(deps: { door: FleetDoor; connections: ConnectionStore; networks: FleetNetworks; isServed: IsServed }): SupplyFleet {
  return async (fleetId) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return ok('not-connected');
    }
    const failed = async (refusal: FleetRefusal) => {
      if (GONE.has(refusal.code)) {
        await deps.connections.drop(fleetId);
        return ok('not-connected' as const);
      }
      return refuse('FLEET_UNAVAILABLE', `The fleet refused the networking plugin: ${refusal.message}`);
    };

    if (!(await deps.isServed(fleetId))) {
      const unregistered = await deps.door.unregisterNetworkPlugin(crew.crewToken);
      return unregistered.isOk || unregistered.error.code === NOT_THE_PLUGIN ? ok('unregistered') : failed(unregistered.error);
    }
    const network = networkOf(await deps.networks.find(fleetId));
    const registered = await deps.door.registerNetworkPlugin(crew.crewToken, network.declaration);
    if (!registered.isOk) {
      return failed(registered.error);
    }
    const supplied = await deps.door.setNetworkRules(crew.crewToken, network.rules);
    return supplied.isOk ? ok('supplied') : failed(supplied.error);
  };
}
