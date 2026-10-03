import type { ShipId } from '@aeolus-fleet/common';

import type { FleetDoor, FleetRefusal, ManagementCrew } from '../management/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { FormationAttempts, RandomNames } from './ports.js';

/** How many random names a ship gets before commissioning gives up on it. */
const NAME_ATTEMPTS = 5;
/** Random characters that tell apart attempts of one squadron begun in the same instant. */
const ATTEMPT_SUFFIX_LENGTH = 8;

/** A formation attempt under way: it commissions ships, each recorded before and after, and can retire them all. */
export interface Formation {
  attemptId: string;
  /**
   * Commissions one ship and answers its crew line. `slot` is its place in
   * the squadron, so a name drawn twice in one attempt never repeats another
   * ship's key; `names` draws a name, again when the fleet holds it already.
   */
  commission: (slot: string, ship: { names: () => string; type: string }) => Promise<Result<{ shipId: ShipId; name: string; crewLine: string }, FleetRefusal>>;
  /** Retires every ship this attempt commissioned and finishes the attempt: it formed nothing. */
  retireCommissioned: () => Promise<void>;
}

/**
 * Begins a formation attempt for a squadron (forming, or adding a member).
 * Because it calls the fleet several times it is no single transaction: the
 * attempt, and each ship by name before it is commissioned, are recorded
 * first, so that a start after a crash retires what an unfinished attempt
 * commissioned (recover-formations). The caller finishes the attempt together
 * with storing what it formed.
 */
export async function beginFormation(
  deps: { door: FleetDoor; attempts: FormationAttempts; random: RandomNames; clock: Clock },
  of: { crew: ManagementCrew; squadronId: string },
): Promise<Formation> {
  const { crew, squadronId } = of;
  // The squadron, the start and a random suffix: attempts sort by start, and two begun in the same
  // instant (forming, then adding a member at once, or under a test's frozen clock) never share an id.
  const startedAt = deps.clock.now();
  const attemptId = `${squadronId}@${startedAt.toISOString()}-${deps.random.suffix(ATTEMPT_SUFFIX_LENGTH)}`;
  await deps.attempts.begin({ id: attemptId, fleetId: crew.fleetId, squadronId, startedAt });
  const commissioned: ShipId[] = [];

  // A lost answer is asked again under the same key, so the fleet commissions
  // no second ship; its repeat holds no secret, so the ship gets a new starting prompt.
  const commissionOnce = async (ship: { name: string; type: string; idempotencyKey: string }): Promise<Result<{ shipId: ShipId; crewLine: string }, FleetRefusal>> => {
    let made = await deps.door.commission(crew.crewToken, ship);
    if (!made.isOk && made.error.code === 'UNAVAILABLE') {
      made = await deps.door.commission(crew.crewToken, ship);
    }
    if (!made.isOk) {
      return made;
    }
    const { shipId, crewLine } = made.value;
    commissioned.push(shipId);
    await deps.attempts.commissioned(attemptId, { name: ship.name, shipId });
    if (crewLine !== null) {
      return ok({ shipId, crewLine });
    }
    const prompt = await deps.door.getStartingPrompt(crew.crewToken, { shipId });
    return prompt.isOk ? ok({ shipId, crewLine: prompt.value.crewLine }) : prompt;
  };

  return {
    attemptId,
    commission: async (slot, ship) => {
      let refusal: FleetRefusal = { code: 'CONFLICT', message: 'no free name' };
      for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
        const shipName = ship.names();
        await deps.attempts.plan(attemptId, shipName);
        const made = await commissionOnce({ name: shipName, type: ship.type, idempotencyKey: `${attemptId}:${slot}:${shipName}` });
        if (made.isOk) {
          return ok({ ...made.value, name: shipName });
        }
        refusal = made.error;
        if (refusal.code !== 'CONFLICT') {
          break;
        }
      }
      return err(refusal);
    },
    retireCommissioned: async () => {
      for (const shipId of commissioned) {
        await deps.door.retire(crew.crewToken, { shipId });
      }
      await deps.attempts.finish(attemptId);
    },
  };
}
