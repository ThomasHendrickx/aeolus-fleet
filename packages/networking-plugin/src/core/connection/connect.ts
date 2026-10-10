import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { Supplies } from '../network/supplies.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ConnectionStatus, FleetDoor, ConnectionStore } from './ports.js';

export type ConnectRefusal = DomainError<'ALREADY_CONNECTED' | 'SECRET_REFUSED' | 'OTHER_FLEET' | 'MISSING_SCOPES'>;

export type Connect = (input: { operatorFleetId: FleetId; shipId: ShipId; secret: string }) => Promise<Result<ConnectionStatus, ConnectRefusal>>;

/** What the networking plugin's ship does (decision 0035): set the fleet's network rules, and read the fleet's labels for the console's editor. */
const PLUGIN_SCOPES = ['fleet:read', 'fleet:network'];

/**
 * Use case: the operator connects the networking plugin, as squadrons and the
 * trierarch plugin are connected. The console's server hands it its ship's
 * secret, server to server; the networking plugin registers with it as a
 * server and keeps only the crew token. The ship must be of the operator's
 * fleet and hold fleet:read and fleet:network, or the networking plugin lets
 * it go again and keeps nothing. Each fleet has its own connection: connect
 * works only while the networking plugin is not connected to the operator's
 * fleet, whatever other fleets it serves. The secret is never kept or logged.
 * Connected, it supplies the fleet at once: it registers as its networking
 * plugin and supplies the rules it holds (decision 0035).
 */
export function createConnect(deps: { door: FleetDoor; store: ConnectionStore; clock: Clock; supplies: Supplies }): Connect {
  return async ({ operatorFleetId, shipId, secret }) => {
    if (await deps.store.find(operatorFleetId)) {
      return refuse('ALREADY_CONNECTED', 'The networking plugin is connected to this fleet already');
    }
    const registered = await deps.door.register({ shipId, secret });
    if (!registered.isOk) {
      return refuse('SECRET_REFUSED', `The fleet refused its ship's secret: ${registered.error.message}`);
    }
    const { crewToken } = registered.value;
    const letGo = async <K extends ConnectRefusal['kind']>(kind: K, message: string) => {
      await deps.door.deregister(crewToken);
      return refuse(kind, message);
    };

    const who = await deps.door.whoami(crewToken);
    if (!who.isOk) {
      return letGo('SECRET_REFUSED', `The fleet refused the new crew token: ${who.error.message}`);
    }
    if (who.value.fleetId !== operatorFleetId) {
      return letGo('OTHER_FLEET', "The ship belongs to another fleet than the operator's");
    }
    const ship = await deps.door.getShip(crewToken, { shipId });
    if (!ship.isOk || !PLUGIN_SCOPES.every((scope) => ship.value.scopes.includes(scope))) {
      return letGo('MISSING_SCOPES', 'The ship needs fleet:read and fleet:network');
    }

    await deps.store.save({ fleetId: who.value.fleetId, shipId, name: who.value.name, crewToken, crewedAt: deps.clock.now() });
    await deps.supplies.supply(who.value.fleetId);
    return ok({ state: 'connected', ship: { shipId, name: who.value.name }, lastShipId: shipId });
  };
}
