import type { FleetId } from '@aeolus-fleet/common';

import type { FleetDoor, FleetShip, ManagementCrewStore } from '../management/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { memberHealth, type MemberHealth } from './member-health.js';
import type { SquadronRepository } from './ports.js';
import { templateOf, type Member, type Squadron } from './squadron.js';

/** A member as the squadron list shows it: with its ship as the fleet shows it now, its check-in interval and its health. */
export interface ListedMember extends Member {
  ship: Pick<FleetShip, 'status' | 'lastSeenAt' | 'crewedSince'>;
  checkInMinutes: number;
  health: MemberHealth;
}

export interface ListedSquadron extends Squadron {
  members: ListedMember[];
}

export type ListRefusal = DomainError<'MANAGEMENT_SHIP_NOT_CREWED' | 'FLEET_UNAVAILABLE'>;

export type ListSquadrons = (fleetId: FleetId) => Promise<Result<ListedSquadron[], ListRefusal>>;

/**
 * Use case: the operator lists the fleet's squadrons (#86, B4), each member
 * with its health. squadrons reads each member's ship from the fleet as its
 * management ship (fleet:read): its crew status, when it was last seen, since
 * when its crew holds it and its last report. A member the fleet does not
 * answer for refuses the list, rather than showing a health it cannot know.
 */
export function createListSquadrons(deps: { door: FleetDoor; management: ManagementCrewStore; squadrons: SquadronRepository; clock: Clock }): ListSquadrons {
  return async (fleetId) => {
    const crew = await deps.management.find(fleetId);
    if (!crew) {
      return refuse('MANAGEMENT_SHIP_NOT_CREWED', 'squadrons is not connected: connect it in the console');
    }
    const now = deps.clock.now();
    const listed: ListedSquadron[] = [];
    for (const squadron of await deps.squadrons.list(fleetId)) {
      const reads = await Promise.all(squadron.members.map((member) => deps.door.getShip(crew.crewToken, { shipId: member.shipId })));
      const members: ListedMember[] = [];
      for (const [index, member] of squadron.members.entries()) {
        const read = reads[index];
        if (!read?.isOk) {
          return refuse('FLEET_UNAVAILABLE', `The fleet did not show the ship of ${member.name}: ${read?.error.message ?? 'no answer'}`);
        }
        const ship = read.value;
        const checkInMinutes = templateOf(squadron, member)?.checkInMinutes ?? 0;
        members.push({
          ...member,
          ship: { status: ship.status, lastSeenAt: ship.lastSeenAt, crewedSince: ship.crewedSince },
          checkInMinutes,
          health: memberHealth(member, { ship, checkInMinutes, now }),
        });
      }
      listed.push({ ...squadron, members });
    }
    return ok(listed);
  };
}
