import type { ShipId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { FleetDoor, ManagementCrewStore } from './ports.js';

export type ManagementRefusal = DomainError<
  'MANAGEMENT_SECRET_MISSING' | 'MANAGEMENT_SECRET_REFUSED' | 'MANAGEMENT_SHIP_CREWED_ELSEWHERE'
>;

export type CrewManagementShip = () => Promise<Result<{ crewToken: string; name: string }, ManagementRefusal>>;

/**
 * Use case: squadrons crews its management ship, the ship with fleet:read and
 * fleet:manage through which it manages squadrons (decision 0017). A crew
 * token it kept from an earlier start crews it again while its lease holds, so
 * a restart needs no new secret. Otherwise it registers with the secret, as a
 * server, and keeps the crew token. Another session crewing the ship is the
 * operator's to release; a refused secret is the operator's to replace.
 */
export function createCrewManagementShip(deps: {
  door: FleetDoor;
  store: ManagementCrewStore;
  clock: Clock;
  ship: { shipId: ShipId; secret: string | undefined };
}): CrewManagementShip {
  return async () => {
    const { shipId, secret } = deps.ship;
    const kept = await deps.store.find();
    if (kept?.shipId === shipId) {
      const crewed = await deps.door.whoami(kept.crewToken);
      if (crewed.isOk) {
        return ok({ crewToken: kept.crewToken, name: crewed.value.name });
      }
    }

    if (secret === undefined) {
      return refuse(
        'MANAGEMENT_SECRET_MISSING',
        'squadrons holds no crew token for its management ship: set MANAGEMENT_SHIP_SECRET from a new starting prompt',
      );
    }
    const registered = await deps.door.register({ shipId, secret });
    if (!registered.isOk) {
      return registered.error.code === 'CONFLICT'
        ? refuse(
            'MANAGEMENT_SHIP_CREWED_ELSEWHERE',
            'Another session crews the management ship: release it in the console, then set the new secret',
          )
        : refuse('MANAGEMENT_SECRET_REFUSED', `The fleet refused the management ship secret: ${registered.error.message}`);
    }

    const { crewToken } = registered.value;
    const crewed = await deps.door.whoami(crewToken);
    if (!crewed.isOk) {
      return refuse('MANAGEMENT_SECRET_REFUSED', `The fleet refused the new crew token: ${crewed.error.message}`);
    }
    await deps.store.save({ fleetId: crewed.value.fleetId, shipId, crewToken, crewedAt: deps.clock.now() });
    return ok({ crewToken, name: crewed.value.name });
  };
}
