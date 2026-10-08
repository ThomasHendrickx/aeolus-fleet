import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { FleetDoor, FleetRefusal, FleetShip, ManagementCrewStore } from '../management/ports.js';
import type { Clock } from '../shared/clock.js';
import type { Result } from '../shared/result.js';
import { STAND_DOWN } from './check-in.js';
import type { SquadronRepository } from './ports.js';
import { retireShip } from './retire-ship.js';
import type { Member, Squadron } from './squadron.js';

export type AdvanceStandDowns = (fleetId: FleetId) => Promise<void>;

/**
 * Use case: squadrons moves every squadron of a fleet standing down one step
 * further (#86, B4), at each flagship rescan, and each member the operator
 * removed from a sailing squadron. A member with a crew request (#343) has it
 * removed and stands down until a trierarch released its crew, before it is
 * retired. A member that never came on station holds no work and is retired
 * at once, after any crew request. Every other member gets its
 * stand-down from the flagship, once, and is retired only after it sent
 * stood-down (it finishes and wraps up first) and holds no open or in-flight
 * delivery. Silence, a missed check-in or an undeliverable stand-down never
 * retires a member: only the operator, removing it or forcing, does. Once every
 * member is retired, the flagship is retired and the squadron is Disbanded,
 * its history kept. Each step is stored as it is taken and is safe to repeat,
 * so a crash or a fleet that does not answer only delays the next one.
 */
export function createAdvanceStandDowns(deps: { door: FleetDoor; management: ManagementCrewStore; squadrons: SquadronRepository; clock: Clock }): AdvanceStandDowns {
  return async (fleetId) => {
    const crew = await deps.management.find(fleetId);
    if (!crew) {
      return;
    }
    const managementToken = crew.crewToken;

    const retire = (shipId: ShipId): Promise<Result<undefined, FleetRefusal>> => retireShip(deps.door, { crewToken: managementToken, shipId });

    /**
     * The member retired, once the fleet holds no crew request for it: a
     * trierarch would keep its ship crewed. Its request is removed first, and
     * it stands down (releasing) until its crew is released.
     */
    const releaseThenRetire = async (member: Member, known?: FleetShip): Promise<Member> => {
      let ship = known;
      if (!ship) {
        const read = await deps.door.getShip(managementToken, { shipId: member.shipId });
        if (!read.isOk) {
          return member;
        }
        ship = read.value;
      }
      if (ship.status !== 'retired' && ship.hasCrewRequest) {
        if (member.releasingSince !== null) {
          return member;
        }
        const removed = await deps.door.removeCrewRequest(managementToken, { shipId: member.shipId });
        return removed.isOk ? { ...member, releasingSince: deps.clock.now() } : member;
      }
      return (await retire(member.shipId)).isOk ? { ...member, retiredAt: deps.clock.now() } : member;
    };

    /** The member one step further, or as it is when it waits on its crew or on the fleet. */
    const advanceMember = async (squadron: Squadron, member: Member): Promise<Member> => {
      if (member.onStationAt === null || member.releasingSince !== null) {
        return releaseThenRetire(member);
      }
      if (member.standDownMessageId === null) {
        const sent = await deps.door.send(squadron.flagship.crewToken, {
          selector: { kind: 'ship', shipId: member.shipId },
          contentType: STAND_DOWN,
          payload: JSON.stringify({ squadron: squadron.id }),
          idempotencyKey: `stand-down-${squadron.id}-${member.shipId}`,
        });
        return sent.isOk ? { ...member, standDownMessageId: sent.value.messageId } : member;
      }
      const ship = await deps.door.getShip(managementToken, { shipId: member.shipId });
      if (!ship.isOk) {
        return member;
      }
      const isDone = ship.value.status === 'retired' || (member.stoodDownAt !== null && ship.value.openDeliveries === 0 && ship.value.inFlightDeliveries === 0);
      return isDone ? releaseThenRetire(member, ship.value) : member;
    };

    for (const squadron of await deps.squadrons.list(crew.fleetId)) {
      const isStandingDown = squadron.state === 'standing-down';
      // A sailing squadron moves only its members the operator removed.
      if (!isStandingDown && squadron.state !== 'sailing') {
        continue;
      }
      let current = squadron;
      for (const member of squadron.members) {
        if (member.retiredAt !== null || (!isStandingDown && member.releasingSince === null)) {
          continue;
        }
        const advanced = isStandingDown ? await advanceMember(current, member) : await releaseThenRetire(member);
        if (advanced !== member) {
          const after = { ...current, members: current.members.map((each) => (each.shipId === member.shipId ? advanced : each)) };
          await deps.squadrons.update({ before: current, after });
          current = after;
        }
      }
      if (isStandingDown && current.members.every((member) => member.retiredAt !== null) && (await retire(current.flagship.shipId)).isOk) {
        await deps.squadrons.update({ before: current, after: { ...current, state: 'disbanded' } });
      }
    }
  };
}
