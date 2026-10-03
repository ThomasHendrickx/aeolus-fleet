import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ConnectionStatus, FleetDoor, ManagementCrewStore } from './ports.js';

export type ConnectRefusal = DomainError<'ALREADY_CONNECTED' | 'SECRET_REFUSED' | 'OTHER_FLEET' | 'MISSING_SCOPES'>;

export type Connect = (input: { operatorFleetId: FleetId; shipId: ShipId; secret: string }) => Promise<Result<ConnectionStatus, ConnectRefusal>>;

/** What squadrons does as its management ship: read the fleet and manage it. */
const MANAGEMENT_SCOPES = ['fleet:read', 'fleet:manage'];

/**
 * Use case: the operator connects squadrons. The web app's server hands it
 * the management ship's secret, server to server; squadrons registers with it
 * as a server and keeps only the crew token. The ship must be of the
 * operator's fleet and hold fleet:read and fleet:manage, or squadrons lets it
 * go again and keeps nothing. Connect works only while squadrons is not
 * connected. The secret is never kept or logged.
 */
export function createConnect(deps: { door: FleetDoor; store: ManagementCrewStore; clock: Clock }): Connect {
  return async ({ operatorFleetId, shipId, secret }) => {
    if (await deps.store.find()) {
      return refuse('ALREADY_CONNECTED', 'squadrons is connected already');
    }
    const registered = await deps.door.register({ shipId, secret });
    if (!registered.isOk) {
      return refuse('SECRET_REFUSED', `The fleet refused the management ship's secret: ${registered.error.message}`);
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
      return letGo('OTHER_FLEET', "The management ship belongs to another fleet than the operator's");
    }
    const ship = await deps.door.getShip(crewToken, { shipId });
    if (!ship.isOk || !MANAGEMENT_SCOPES.every((scope) => ship.value.scopes.includes(scope))) {
      return letGo('MISSING_SCOPES', 'The management ship needs fleet:read and fleet:manage');
    }

    await deps.store.save({ fleetId: who.value.fleetId, shipId, name: who.value.name, crewToken, crewedAt: deps.clock.now() });
    return ok({ state: 'connected', ship: { shipId, name: who.value.name }, lastShipId: shipId });
  };
}
