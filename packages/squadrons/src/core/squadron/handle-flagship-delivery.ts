import { z } from 'zod';

import { FLAGSHIP } from '../catalogue/catalogue.js';
import type { FleetDoor, FleetRefusal, OutgoingMessage, ReceivedMessage } from '../management/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import { CHECK_IN, checkInText, ON_STATION, ROLE } from './check-in.js';
import type { FlagshipMessageLog, OperatorNotices, SquadronRepository } from './ports.js';
import type { Member, Squadron } from './squadron.js';

export type FlagshipDelivery = ReceivedMessage;

/** What the flagship did: answered a check-in, took a member on station, or kept a message it does not handle. */
export type FlagshipOutcome = 'answered' | 'on-station' | 'kept';

export type HandleFlagshipDelivery = (squadron: Squadron, delivery: FlagshipDelivery) => Promise<Result<FlagshipOutcome, FleetRefusal>>;

const checkInPayload = z.object({ squadron: z.string(), model: z.string().optional() });
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
 * "Check-in"). A member's check-in for this squadron is acknowledged, kept
 * with the model the member states, and answered with its role, every time it
 * checks in. A member's on-station is
 * acknowledged and the member marked on station from then, again after each
 * new check-in; the squadron sails when every member is. A flagship supports only the squadron's messages: anything else,
 * from outside or from a member, is acknowledged and kept for the squadron
 * page, never forwarded, and argo is told, so no message disappears or goes
 * unseen. A delivery is acked only after it is handled; the delivery id keys
 * every step, so one that comes again gets the same answer and no second change.
 */
export function createHandleFlagshipDelivery(deps: {
  door: FleetDoor;
  squadrons: SquadronRepository;
  messages: FlagshipMessageLog;
  operator: OperatorNotices;
  clock: Clock;
}): HandleFlagshipDelivery {
  return async (squadron, delivery) => {
    const member = squadron.members.find((each) => each.shipId === delivery.senderShipId);
    const crewToken = squadron.flagship.crewToken;
    // Every step is safe to repeat, so the delivery is acked only once it is handled: a crash or a
    // failed ack in between hands it to the flagship again, and handling it again changes nothing.
    const acked = async (outcome: FlagshipOutcome): Promise<Result<FlagshipOutcome, FleetRefusal>> => {
      const ack = await deps.door.ack(crewToken, delivery.deliveryId);
      return ack.isOk ? ok(outcome) : err(ack.error);
    };
    const keep = async (): Promise<Result<FlagshipOutcome, FleetRefusal>> => {
      const { deliveryId, messageId, senderShipId, senderName, contentType, payload, inReplyTo } = delivery;
      await deps.messages.keep({
        fleetId: squadron.fleetId,
        squadronId: squadron.id,
        deliveryId,
        messageId,
        senderShipId,
        senderName,
        contentType,
        payload,
        inReplyTo,
        receivedAt: deps.clock.now(),
      });
      await deps.operator.tell({
        text: `The flagship of the squadron ${squadron.id} got a message it does not handle, from ${senderName} (${contentType}). squadrons keeps it for the squadron page; nothing was forwarded.`,
        key: `kept-${deliveryId}`,
      });
      return acked('kept');
    };

    if (delivery.contentType === CHECK_IN) {
      const checkIn = parsedPayload(checkInPayload, delivery.payload);
      if (!member || checkIn?.squadron !== squadron.id) {
        return keep();
      }
      const checkedIn = { at: deps.clock.now(), model: checkIn.model ?? null };
      await deps.squadrons.update({
        before: squadron,
        after: { ...squadron, members: squadron.members.map((each) => (each.shipId === member.shipId ? { ...each, checkIn: checkedIn } : each)) },
      });
      const answered = await deps.door.send(crewToken, roleMessage(squadron, { member, checkIn: delivery }));
      return answered.isOk ? acked('answered') : err(answered.error);
    }

    if (delivery.contentType === ON_STATION) {
      const onStation = parsedPayload(onStationPayload, delivery.payload);
      if (!member || onStation?.squadron !== squadron.id) {
        return keep();
      }
      const at = deps.clock.now();
      // A member that checked in since it last came on station, after /clear or with a new crew, comes on station
      // again from now; the same on-station coming again finds it on station since that check-in and changes nothing.
      const isOnStationSinceCheckIn = member.onStationAt !== null && (member.checkIn === null || member.onStationAt >= member.checkIn.at);
      const members = squadron.members.map((each) => (each.shipId === member.shipId && !isOnStationSinceCheckIn ? { ...each, onStationAt: at } : each));
      const isAllOnStation = members.every((each) => each.onStationAt !== null);
      const isSailing = squadron.state === 'forming' && isAllOnStation;
      await deps.squadrons.update({
        before: squadron,
        after: { ...squadron, members, state: isSailing ? 'sailing' : squadron.state, sailedAt: isSailing ? at : squadron.sailedAt },
      });
      return acked('on-station');
    }

    return keep();
  };
}
