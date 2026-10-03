import type { ShipId } from '@aeolus-fleet/common';

import type { FleetDoor, FleetRefusal, ManagementCrewStore } from '../management/ports.js';
import type { Clock } from '../shared/clock.js';
import type { Result } from '../shared/result.js';
import { STAND_DOWN } from './check-in.js';
import type { SquadronRepository } from './ports.js';
import { retireShip } from './retire-ship.js';
import type { Member, Squadron } from './squadron.js';

export type AdvanceStandDowns = () => Promise<void>;

/**
 * Use case: squadrons moves every squadron standing down one step further
 * (#86, B4), at each flagship rescan. A member that never came on station
 * holds no work and is retired at once. Every other member gets its
 * stand-down from the flagship, once, and is retired only after it sent
 * stood-down (it finishes and wraps up first) and holds no open or in-flight
 * delivery. Silence, a missed check-in or an undeliverable stand-down never
 * retires a member: only the operator, removing it or forcing, does. Once every
 * member is retired, the flagship is retired and the squadron is Disbanded,
 * its history kept. Each step is stored as it is taken and is safe to repeat,
 * so a crash or a fleet that does not answer only delays the next one.
 */
export function createAdvanceStandDowns(deps: { door: FleetDoor; management: ManagementCrewStore; squadrons: SquadronRepository; clock: Clock }): AdvanceStandDowns {
  return async () => {
    const crew = await deps.management.find();
    if (!crew) {
      return;
    }
    const managementToken = crew.crewToken;

    const retire = (shipId: ShipId): Promise<Result<undefined, FleetRefusal>> => retireShip(deps.door, { crewToken: managementToken, shipId });

    /** The member one step further, or as it is when it waits on its crew or on the fleet. */
    const advanceMember = async (squadron: Squadron, member: Member): Promise<Member> => {
      if (member.onStationAt === null) {
        return (await retire(member.shipId)).isOk ? { ...member, retiredAt: deps.clock.now() } : member;
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
      return isDone && (await retire(member.shipId)).isOk ? { ...member, retiredAt: deps.clock.now() } : member;
    };

    for (const squadron of await deps.squadrons.list(crew.fleetId)) {
      if (squadron.state !== 'standing-down') {
        continue;
      }
      let current = squadron;
      for (const member of squadron.members) {
        if (member.retiredAt !== null) {
          continue;
        }
        const advanced = await advanceMember(current, member);
        if (advanced !== member) {
          const after = { ...current, members: current.members.map((each) => (each.shipId === member.shipId ? advanced : each)) };
          await deps.squadrons.update({ before: current, after });
          current = after;
        }
      }
      if (current.members.every((member) => member.retiredAt !== null) && (await retire(current.flagship.shipId)).isOk) {
        await deps.squadrons.update({ before: current, after: { ...current, state: 'disbanded' } });
      }
    }
  };
}
