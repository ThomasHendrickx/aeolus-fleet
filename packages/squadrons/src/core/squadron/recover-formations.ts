import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { FleetDoor, FleetRefusal, ManagementCrewStore } from '../management/ports.js';
import { ok, type Result } from '../shared/result.js';
import type { FormationAttempt, FormationAttempts } from './ports.js';

/** Five tries, like commissioning's name attempts: tolerate temporary refusals, then ask argo to handle it. */
const RECOVERY_REFUSAL_LIMIT = 5;

/** What the fleet answers when a ship is retired already (CONFLICT), or does not exist. */
const NOTHING_TO_RETIRE: ReadonlySet<string> = new Set(['CONFLICT', 'NOT_FOUND']);

/**
 * Which unfinished attempts a recovery undoes: `all` where no forming runs (at
 * start, and on connecting), `given-up` at a rescan, where a forming may hold one.
 */
export type RecoveredAttempts = 'all' | 'given-up';

export type RecoverFormations = (fleetId: FleetId, which: RecoveredAttempts) => Promise<Result<{ recovered: number; retired: number }, FleetRefusal>>;

/**
 * Use case: at start, and on connecting, squadrons undoes every formation of a
 * fleet a crash or a refused retire left unfinished, and at every rescan each
 * one its forming gave up, so forming stays all or nothing across a crash (a controller is
 * safe to kill at any moment and recomputes from what it stored). Every ship
 * the attempt recorded is retired: by its id, or, for one commissioned but
 * killed before its id was recorded, by its name among the fleet's ships. A
 * ship retired already is fine. Then the attempt is finished, unless the
 * fleet refused one of its retires: it stays unfinished, so the next
 * recovery retires that ship (#738). After five refused recovery passes,
 * retiring stops and argo gets one plain notice (#740). The notice keeps the
 * same key across retries and restarts; finishing waits for its durable send.
 */
export function createRecoverFormations(deps: { door: FleetDoor; management: ManagementCrewStore; attempts: FormationAttempts }): RecoverFormations {
  const tellArgo = async (attempt: FormationAttempt, crewToken: string) => deps.door.send(crewToken, {
    selector: { kind: 'ship', name: 'argo' },
    contentType: 'text/plain',
    payload: `Formation recovery stopped in fleet ${attempt.fleetId} after ${String(RECOVERY_REFUSAL_LIMIT)} refused retire passes. Ships: ${attempt.ships.map((ship) => ship.name).join(', ')}. Check and retire the ships still active.`,
    idempotencyKey: `formation-recovery-stopped-${attempt.id}`,
  });

  return async (fleetId, which) => {
    const crew = await deps.management.find(fleetId);
    if (!crew) {
      return ok({ recovered: 0, retired: 0 });
    }
    const unfinished = (await deps.attempts.unfinished(crew.fleetId)).filter((attempt) => which === 'all' || attempt.isGivenUp);
    let retired = 0;
    for (const attempt of unfinished) {
      if (attempt.recoveryRefusals >= RECOVERY_REFUSAL_LIMIT) {
        const told = await tellArgo(attempt, crew.crewToken);
        if (!told.isOk) {
          return told;
        }
        await deps.attempts.finish(attempt.id);
        continue;
      }
      let byName: Map<string, ShipId> | undefined;
      if (attempt.ships.some((ship) => ship.shipId === null)) {
        const listed = await deps.door.listShips(crew.crewToken);
        if (!listed.isOk) {
          return listed;
        }
        byName = new Map(listed.value.map((ship) => [ship.name, ship.shipId]));
      }
      let isEveryShipRetired = true;
      for (const ship of attempt.ships) {
        const shipId = ship.shipId ?? byName?.get(ship.name);
        if (shipId === undefined) {
          continue;
        }
        const retire = await deps.door.retire(crew.crewToken, { shipId });
        if (retire.isOk) {
          retired += 1;
        } else if (!NOTHING_TO_RETIRE.has(retire.error.code)) {
          isEveryShipRetired = false;
        }
      }
      if (isEveryShipRetired) {
        await deps.attempts.finish(attempt.id);
      } else {
        const recoveryRefusals = attempt.recoveryRefusals + 1;
        await deps.attempts.recordRecoveryRefusal(crew.fleetId, attempt.id);
        if (recoveryRefusals >= RECOVERY_REFUSAL_LIMIT) {
          const told = await tellArgo(attempt, crew.crewToken);
          if (!told.isOk) {
            return told;
          }
          await deps.attempts.finish(attempt.id);
        }
      }
    }
    return ok({ recovered: unfinished.length, retired });
  };
}
