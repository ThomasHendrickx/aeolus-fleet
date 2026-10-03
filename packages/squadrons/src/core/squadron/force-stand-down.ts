import type { FleetId } from '@aeolus-fleet/common';

import type { FleetDoor, ManagementCrewStore } from '../management/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { SquadronRepository } from './ports.js';
import { retireShip } from './retire-ship.js';

export type ForceStandDownRefusal = DomainError<'MANAGEMENT_SHIP_NOT_CREWED' | 'SQUADRON_NOT_FOUND' | 'ALREADY_DISBANDED' | 'FLEET_UNAVAILABLE'>;

export type ForceStandDown = (input: { fleetId: FleetId; squadronId: string }) => Promise<Result<undefined, ForceStandDownRefusal>>;

/**
 * Use case: the operator forces the stand down of a Forming, Sailing or
 * Standing down squadron (#86, B4). squadrons retires every member not
 * retired yet, then the flagship, at once, and the squadron is Disbanded.
 * Each retire abandons the ship's direct deliveries, as any retire does: only
 * this explicit operator action retires a member that did not stand down.
 * Each retire is stored as it happens; when the fleet does not answer for a
 * ship, what is retired stays retired, and forcing again finishes the rest.
 */
export function createForceStandDown(deps: { door: FleetDoor; management: ManagementCrewStore; squadrons: SquadronRepository; clock: Clock }): ForceStandDown {
  return async ({ fleetId, squadronId }) => {
    const crew = await deps.management.find();
    if (!crew) {
      return refuse('MANAGEMENT_SHIP_NOT_CREWED', 'squadrons is not connected: connect it in the console');
    }
    const squadron = (await deps.squadrons.list(fleetId)).find((each) => each.id === squadronId);
    if (!squadron) {
      return refuse('SQUADRON_NOT_FOUND', `The fleet has no squadron ${squadronId}`);
    }
    if (squadron.state === 'disbanded') {
      return refuse('ALREADY_DISBANDED', `The squadron ${squadronId} is disbanded already`);
    }
    let current = squadron;
    for (const member of squadron.members) {
      if (member.retiredAt !== null) {
        continue;
      }
      const retired = await retireShip(deps.door, { crewToken: crew.crewToken, shipId: member.shipId });
      if (!retired.isOk) {
        return refuse('FLEET_UNAVAILABLE', `The fleet did not retire ${member.name}: ${retired.error.message}`);
      }
      const after = { ...current, members: current.members.map((each) => (each.shipId === member.shipId ? { ...each, retiredAt: deps.clock.now() } : each)) };
      await deps.squadrons.update({ before: current, after });
      current = after;
    }
    const flagship = await retireShip(deps.door, { crewToken: crew.crewToken, shipId: squadron.flagship.shipId });
    if (!flagship.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not retire the flagship ${squadron.flagship.name}: ${flagship.error.message}`);
    }
    await deps.squadrons.update({ before: current, after: { ...current, state: 'disbanded' } });
    return ok(undefined);
  };
}
