import { z } from 'zod';

import { FLAGSHIP } from '../catalogue/catalogue.js';
import type { FleetDoor, FleetRefusal, OutgoingMessage, ReceivedMessage } from '../management/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import { CHECK_IN, checkInText, ON_STATION, ROLE } from './check-in.js';
import type { SquadronRepository } from './ports.js';
import type { Member, Squadron } from './squadron.js';

export type FlagshipDelivery = ReceivedMessage;

/** What the flagship did: answered a check-in, took a member on station, or left the delivery for later. */
export type FlagshipOutcome = 'answered' | 'on-station' | 'unhandled';

export type HandleFlagshipDelivery = (squadron: Squadron, delivery: FlagshipDelivery) => Promise<Result<FlagshipOutcome, FleetRefusal>>;

const checkInPayload = z.object({ squadron: z.string() });
const onStationPayload = z.object({ squadron: z.string(), role: z.string() });

/** The payload, parsed as JSON and checked; undefined when it is neither. */
function parsedPayload<T>(schema: z.ZodType<T>, payload: string): T | undefined {
  try {
    return schema.safeParse(JSON.parse(payload)).data;
  } catch {
    return undefined;
  }
}

/** The member's role message (docs/squadrons.md, "Check-in"): each hand-off as the selector to send to. */
function roleMessage(squadron: Squadron, answering: { member: Member; checkIn: FlagshipDelivery }): OutgoingMessage {
  const { member, checkIn: inReplyTo } = answering;
  const role = squadron.blueprint.roles.find((each) => each.name === member.role);
  const template = squadron.templates.find(
    (each) => each.repository === role?.template.repository && each.name === role.template.name && each.version === role.template.version,
  );
  const handoffs = Object.fromEntries(
    squadron.blueprint.handoffs
      .filter((handoff) => handoff.role === member.role)
      .map((handoff) => [
        handoff.handoff,
        handoff.to === FLAGSHIP ? { kind: 'ship', name: squadron.flagship.name } : { kind: 'type', type: `${squadron.id}:${handoff.to}` },
      ]),
  );
  return {
    selector: { kind: 'ship', shipId: member.shipId },
    contentType: ROLE,
    inReplyTo: inReplyTo.messageId,
    idempotencyKey: `role-${inReplyTo.deliveryId}`,
    payload: JSON.stringify({
      squadron: squadron.id,
      role: member.role,
      template: `${template?.name ?? member.role}@${String(template?.version ?? 0)}`,
      charter: template?.charter ?? '',
      checkIn: checkInText(template?.checkInMinutes ?? 0),
      handoffs,
      flagship: squadron.flagship.name,
    }),
  };
}

/**
 * Use case: the flagship handles one delivery (docs/squadrons.md,
 * "Check-in"). A member's check-in for this squadron is acknowledged and
 * answered with its role, every time it checks in. A member's on-station is
 * acknowledged and the member marked on station; the squadron sails when every
 * member is. Anything else is left unacknowledged for now, so it is not lost:
 * what the flagship does with other messages is not decided yet. Nothing is
 * answered unless the ack succeeded.
 */
export function createHandleFlagshipDelivery(deps: { door: FleetDoor; squadrons: SquadronRepository; clock: Clock }): HandleFlagshipDelivery {
  return async (squadron, delivery) => {
    const member = squadron.members.find((each) => each.shipId === delivery.senderShipId);
    const crewToken = squadron.flagship.crewToken;

    if (delivery.contentType === CHECK_IN) {
      const checkIn = parsedPayload(checkInPayload, delivery.payload);
      if (!member || checkIn?.squadron !== squadron.id) {
        return ok('unhandled');
      }
      const acked = await deps.door.ack(crewToken, delivery.deliveryId);
      if (!acked.isOk) {
        return err(acked.error);
      }
      const answered = await deps.door.send(crewToken, roleMessage(squadron, { member, checkIn: delivery }));
      return answered.isOk ? ok('answered') : err(answered.error);
    }

    if (delivery.contentType === ON_STATION) {
      const onStation = parsedPayload(onStationPayload, delivery.payload);
      if (!member || onStation?.squadron !== squadron.id) {
        return ok('unhandled');
      }
      const acked = await deps.door.ack(crewToken, delivery.deliveryId);
      if (!acked.isOk) {
        return err(acked.error);
      }
      const at = deps.clock.now();
      const members = squadron.members.map((each) => (each.shipId === member.shipId ? { ...each, onStationAt: each.onStationAt ?? at } : each));
      const isAllOnStation = members.every((each) => each.onStationAt !== null);
      const isSailing = squadron.state === 'forming' && isAllOnStation;
      await deps.squadrons.update({ ...squadron, members, state: isSailing ? 'sailing' : squadron.state, sailedAt: isSailing ? at : squadron.sailedAt });
      return ok('on-station');
    }

    return ok('unhandled');
  };
}
