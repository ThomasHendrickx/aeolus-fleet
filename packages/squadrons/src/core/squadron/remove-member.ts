import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { FleetDoor, ManagementCrewStore } from '../management/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { SquadronRepository } from './ports.js';
import { retireShip } from './retire-ship.js';

export type RemoveRefusal = DomainError<'MANAGEMENT_SHIP_NOT_CREWED' | 'SQUADRON_NOT_FOUND' | 'SQUADRON_NOT_SERVING' | 'MEMBER_NOT_FOUND' | 'FLEET_UNAVAILABLE'>;

export type RemoveMember = (input: { fleetId: FleetId; squadronId: string; shipId: ShipId }) => Promise<Result<undefined, RemoveRefusal>>;

/**
 * Use case: the operator removes a member of a sailing or standing-down
 * squadron (#86, B4). squadrons retires its ship at once: its direct
 * deliveries are abandoned, as on any retire, and a delivery to its type goes
 * to another member of the role. No rule keeps a role filled: once the last
 * member of a role is removed, a hand-off to it fails at send. In a squadron
 * standing down, this is how the operator lets go of a member that never
 * stands down.
 */
export function createRemoveMember(deps: { door: FleetDoor; management: ManagementCrewStore; squadrons: SquadronRepository; clock: Clock }): RemoveMember {
  return async ({ fleetId, squadronId, shipId }) => {
    const crew = await deps.management.find(fleetId);
    if (!crew) {
      return refuse('MANAGEMENT_SHIP_NOT_CREWED', 'squadrons is not connected: connect it in the console');
    }
    const squadron = (await deps.squadrons.list(fleetId)).find((each) => each.id === squadronId);
    if (!squadron) {
      return refuse('SQUADRON_NOT_FOUND', `The fleet has no squadron ${squadronId}`);
    }
    if (squadron.state !== 'sailing' && squadron.state !== 'standing-down') {
      return refuse('SQUADRON_NOT_SERVING', `The squadron ${squadronId} is ${squadron.state}: members are removed while it sails or stands down`);
    }
    const member = squadron.members.find((each) => each.shipId === shipId);
    if (!member) {
      return refuse('MEMBER_NOT_FOUND', `The squadron ${squadronId} has no member ${shipId}`);
    }
    const retired = await retireShip(deps.door, { crewToken: crew.crewToken, shipId });
    if (!retired.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not retire ${member.name}: ${retired.error.message}`);
    }
    if (member.retiredAt === null) {
      await deps.squadrons.update({
        before: squadron,
        after: { ...squadron, members: squadron.members.map((each) => (each.shipId === shipId ? { ...each, retiredAt: deps.clock.now() } : each)) },
      });
    }
    return ok(undefined);
  };
}
