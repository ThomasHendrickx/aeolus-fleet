import type { ShipId } from '@aeolus-fleet/common';

import type { FleetDoor, FleetRefusal, ManagementCrewStore } from '../management/ports.js';
import { ok, type Result } from '../shared/result.js';
import type { FormationAttempts } from './ports.js';

export type RecoverFormations = () => Promise<Result<{ recovered: number; retired: number }, FleetRefusal>>;

/**
 * Use case: at start, squadrons undoes every formation a crash left
 * unfinished, so forming stays all or nothing across a crash (a controller is
 * safe to kill at any moment and recomputes from what it stored). Every ship
 * the attempt recorded is retired: by its id, or, for one commissioned but
 * killed before its id was recorded, by its name among the fleet's ships. A
 * ship retired already is fine. Then the attempt is finished.
 */
export function createRecoverFormations(deps: { door: FleetDoor; management: ManagementCrewStore; attempts: FormationAttempts }): RecoverFormations {
  return async () => {
    const crew = await deps.management.find();
    if (!crew) {
      return ok({ recovered: 0, retired: 0 });
    }
    const unfinished = await deps.attempts.unfinished(crew.fleetId);
    let retired = 0;
    for (const attempt of unfinished) {
      let byName: Map<string, ShipId> | undefined;
      if (attempt.ships.some((ship) => ship.shipId === null)) {
        const listed = await deps.door.listShips(crew.crewToken);
        if (!listed.isOk) {
          return listed;
        }
        byName = new Map(listed.value.map((ship) => [ship.name, ship.shipId]));
      }
      for (const ship of attempt.ships) {
        const shipId = ship.shipId ?? byName?.get(ship.name);
        if (shipId !== undefined && (await deps.door.retire(crew.crewToken, { shipId })).isOk) {
          retired += 1;
        }
      }
      await deps.attempts.finish(attempt.id);
    }
    return ok({ recovered: unfinished.length, retired });
  };
}
