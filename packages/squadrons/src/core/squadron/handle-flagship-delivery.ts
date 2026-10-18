import { argoMessage, isPingContentType, MARKDOWN_CONTENT_TYPE, PAYLOAD_MAX_BYTES, payloadBytes, type MessageId } from '@aeolus-fleet/common';
import { z } from 'zod';

import { FLAGSHIP } from '../catalogue/catalogue.js';
import { fillParameters } from '../catalogue/member-crew.js';
import type { FleetDoor, FleetRefusal, ManagementCrewStore, OutgoingMessage, ReceivedMessage } from '../management/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { AddMember } from './add-member.js';
import type { AdvanceStandDowns } from './advance-stand-downs.js';
import { CHECK_IN, checkInText, ON_STATION, ROLE, STAND_DOWN, STOOD_DOWN } from './check-in.js';
import { FORM_SCOPE } from './form-messages.js';
import type { FlagshipMessageLog, OperatorNotices, Relay, RelayLog, SquadronRepository } from './ports.js';
import { ADD_MEMBER, ARGO_NAME, MEMBER_ADDED, MEMBER_REMOVED, REFUSED, RELAY, REMOVE_MEMBER, SCALE_SCOPE, STANDING_DOWN } from './proxy-messages.js';
import { contactOf, contactSelector, isFromContact, type Contact } from './squadron-contact.js';
import type { RemoveMember } from './remove-member.js';
import type { StandDown } from './stand-down.js';
import type { Member, Squadron } from './squadron.js';

export type FlagshipDelivery = ReceivedMessage;

/** What the flagship did: answered a check-in, took a member on station, recorded a stood-down, stood its squadron down, added or removed a member, relayed between its squadron and its contact, refused a request, kept a message it does not handle, or answered argo's ping with pong. */
export type FlagshipOutcome = 'answered' | 'on-station' | 'stood-down' | 'standing-down' | 'member-added' | 'member-removed' | 'relayed' | 'refused' | 'kept' | 'ponged';

export type HandleFlagshipDelivery = (squadron: Squadron, delivery: FlagshipDelivery) => Promise<Result<FlagshipOutcome, FleetRefusal>>;

const checkInPayload = z.object({ squadron: z.string(), model: z.string().optional() });
const onStationPayload = z.object({ squadron: z.string(), role: z.string() });
const stoodDownPayload = z.object({ squadron: z.string() });
const addMemberPayload = z.object({ squadron: z.string(), role: z.string(), parameters: z.record(z.string(), z.string()).optional(), key: z.string().min(1) });
const removeMemberPayload = z.object({ squadron: z.string(), member: z.string() });
const relayPayload = z.object({
  squadron: z.string(),
  to: z.union([z.object({ member: z.string() }), z.object({ role: z.string() })]).optional(),
  payload: z.string(),
});

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
      charter: fillParameters(template?.charter ?? '', member.parameters),
      checkIn: checkInText(template?.checkInMinutes ?? 0),
      handoffs,
      flagship: squadron.flagship.name,
      // A member that starts while its squadron stands down finishes its work and sends stood-down.
      ...(squadron.state === 'standing-down' ? { standingDown: true } : {}),
    }),
  };
}

/** What the contact may ask of the flagship by message, with the scope it needs, as the refusals name it. */
const STANDING_DOWN_ASK = { scope: FORM_SCOPE, does: 'stands it down', doing: 'Standing a squadron down' };
const SCALING_ASK = { scope: SCALE_SCOPE, does: 'adds and removes its members', doing: 'Adding and removing members' };

/** Where the forming ship's relay goes: the member whose relay it answers, else the member or role it names. */
function relayTarget(
  squadron: Squadron,
  relay: { answered: Relay | undefined; to: z.infer<typeof relayPayload>['to'] },
): Result<{ selector: OutgoingMessage['selector']; inReplyTo?: MessageId }, string> {
  const { answered, to } = relay;
  if (answered) {
    return ok({ selector: { kind: 'ship', shipId: answered.memberShipId }, inReplyTo: answered.memberMessageId });
  }
  if (to === undefined) {
    return err('A relay that answers no member\'s relay names a member or a role in to');
  }
  if ('role' in to) {
    return squadron.blueprint.roles.some((each) => each.name === to.role)
      ? ok({ selector: { kind: 'type', type: `${squadron.id}:${to.role}` } })
      : err(`The squadron ${squadron.id} has no role ${to.role}`);
  }
  const named = squadron.members.find((each) => each.name === to.member && each.retiredAt === null);
  return named ? ok({ selector: { kind: 'ship', shipId: named.shipId } }) : err(`The squadron ${squadron.id} has no member ${to.member}`);
}

/**
 * Use case: the flagship handles one delivery (docs/squadrons.md,
 * "Check-in"). A member's check-in for this squadron is acknowledged, kept
 * with the model the member states, and answered with its role, every time it
 * checks in. A member's on-station is
 * acknowledged and the member marked on station from then, again after each
 * new check-in; the squadron sails when every member is. While the squadron
 * stands down, a member's stood-down is recorded and acked, then the
 * stand-downs advance, so the member is retired when it holds no open deliveries;
 * a check-in then is answered with a role message saying the squadron stands
 * down. The flagship is the proxy between its squadron and its contact
 * (decision 0017): its forming ship, argo for a squadron argo formed, and once
 * the forming ship is retired that ship's owner, argo when it has none (0.R).
 * A member's relay goes on to the contact, and the contact's relay to the
 * member it answers or names, or one ship of the role it names. The contact,
 * while it holds squadrons:form, or argo stands a sailing squadron down by
 * message, and the contact while it holds squadrons:scale, or argo, adds a
 * member of a role, crewed by request, and removes a member by name; any
 * other ship is refused. A request to add that comes again under its key is
 * answered with the member it added. A flagship supports only these
 * messages: anything else, from outside or from a member, is acknowledged and
 * kept for the squadron page, never forwarded, and the contact is told, so no
 * message disappears or goes unseen. A ping from argo gets pong instead of ack, as on any ship
 * (blueprint, "Ping"). A delivery is acked only after it is handled; the delivery id keys
 * every step, so one that comes again gets the same answer and no second change.
 */
export function createHandleFlagshipDelivery(deps: {
  door: FleetDoor;
  squadrons: SquadronRepository;
  messages: FlagshipMessageLog;
  operator: OperatorNotices;
  relays: RelayLog;
  /** squadrons' own ship, which reads the forming ship's scopes from the fleet. */
  management: Pick<ManagementCrewStore, 'find'>;
  standDown: StandDown;
  addMember: AddMember;
  removeMember: RemoveMember;
  advanceStandDowns: AdvanceStandDowns;
  clock: Clock;
}): HandleFlagshipDelivery {
  const answerRefused = async (squadron: Squadron, refusal: { delivery: FlagshipDelivery; code: string; message: string }): Promise<Result<FlagshipOutcome, FleetRefusal>> => {
    const { delivery, code, message } = refusal;
    const sent = await deps.door.send(squadron.flagship.crewToken, {
      selector: { kind: 'ship', shipId: delivery.senderShipId },
      contentType: REFUSED,
      inReplyTo: delivery.messageId,
      idempotencyKey: `refused-${delivery.deliveryId}`,
      payload: JSON.stringify({ squadron: squadron.id, code, message }),
    });
    return sent.isOk ? ok('refused') : err(sent.error);
  };

  // A member's relay goes on to the squadron's contact, recorded so its answer comes back.
  const relayToContact = async (squadron: Squadron, relay: { contact: Contact; member: Member; delivery: FlagshipDelivery; payload: string }): Promise<Result<FlagshipOutcome, FleetRefusal>> => {
    const { contact, member, delivery } = relay;
    const payload = JSON.stringify({ squadron: squadron.id, member: { name: member.name, role: member.role }, messageId: delivery.messageId, payload: relay.payload });
    if (payloadBytes(payload) > PAYLOAD_MAX_BYTES) {
      return answerRefused(squadron, {
        delivery,
        code: 'PAYLOAD_TOO_LARGE',
        message: `With the relay's envelope the payload is over ${String(PAYLOAD_MAX_BYTES / 1024)} KB: send where the content lives (a path, a URL, a PR link)`,
      });
    }
    const sent = await deps.door.send(squadron.flagship.crewToken, {
      selector: contactSelector(contact),
      contentType: RELAY,
      idempotencyKey: `relay-${delivery.deliveryId}`,
      payload,
    });
    if (!sent.isOk) {
      return err(sent.error);
    }
    await deps.relays.record({ fleetId: squadron.fleetId, squadronId: squadron.id, relayMessageId: sent.value.messageId, memberShipId: member.shipId, memberMessageId: delivery.messageId });
    return ok('relayed');
  };

  // The contact's relay goes to the member it answers, or to the member or role it names.
  const relayFromContact = async (squadron: Squadron, relayed: { delivery: FlagshipDelivery; relay: z.infer<typeof relayPayload> }): Promise<Result<FlagshipOutcome, FleetRefusal>> => {
    const { delivery, relay } = relayed;
    const answered = delivery.inReplyTo === null ? undefined : await deps.relays.find(squadron.fleetId, delivery.inReplyTo);
    const target = relayTarget(squadron, { answered, to: relay.to });
    if (!target.isOk) {
      return answerRefused(squadron, { delivery, code: 'NO_SUCH_MEMBER', message: target.error });
    }
    const sent = await deps.door.send(squadron.flagship.crewToken, {
      selector: target.value.selector,
      contentType: RELAY,
      ...(target.value.inReplyTo === undefined ? {} : { inReplyTo: target.value.inReplyTo }),
      idempotencyKey: `relay-${delivery.deliveryId}`,
      payload: JSON.stringify({ squadron: squadron.id, from: delivery.senderName, payload: relay.payload }),
    });
    return sent.isOk ? ok('relayed') : err(sent.error);
  };

  // Whether the sender may ask this of the flagship: argo always; its contact, the forming ship or once that is retired its owner, while it holds the scope, read from the fleet.
  const mayAsk = async (
    squadron: Squadron,
    asking: { delivery: FlagshipDelivery; ask: typeof STANDING_DOWN_ASK },
  ): Promise<Result<{ code: string; message: string } | undefined, FleetRefusal>> => {
    const { delivery, ask } = asking;
    if (delivery.senderName === ARGO_NAME) {
      return ok(undefined);
    }
    const contact = await contactOf(deps, squadron);
    if (!contact.isOk) {
      return contact;
    }
    if (contact.value.kind === 'argo' || !isFromContact(contact.value, delivery)) {
      return ok({ code: 'NOT_FORMING_SHIP', message: `Only the ship that formed ${squadron.id}, its owner once it is retired, or argo ${ask.does}` });
    }
    const crew = await deps.management.find(squadron.fleetId);
    if (!crew) {
      return err({ code: 'NOT_CONNECTED', message: 'squadrons is not connected to this fleet' });
    }
    const sender = await deps.door.getShip(crew.crewToken, { shipId: delivery.senderShipId });
    if (!sender.isOk) {
      return err(sender.error);
    }
    return ok(sender.value.scopes.includes(ask.scope) ? undefined : { code: 'NEEDS_SCOPE', message: `${ask.doing} needs ${ask.scope}, which ${delivery.senderName} does not hold` });
  };

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
      const notice = {
        headline: `${senderName} sent a flagship a message it does not handle`,
        body: `- Squadron: \`${squadron.id}\`\n- From: ${senderName}\n- Content type: \`${contentType}\`\n\nsquadrons keeps it for the squadron page; nothing was forwarded.`,
      };
      const contact = await contactOf(deps, squadron);
      if (!contact.isOk) {
        return err(contact.error);
      }
      // The squadron's one contact outside it is told: argo as argo, any other contact by message.
      if (contact.value.kind === 'argo') {
        await deps.operator.tell({ fleetId: squadron.fleetId, ...notice, key: `kept-${deliveryId}` });
      } else {
        const told = await deps.door.send(crewToken, {
          selector: contactSelector(contact.value),
          contentType: MARKDOWN_CONTENT_TYPE,
          idempotencyKey: `kept-${deliveryId}`,
          payload: argoMessage(notice),
        });
        if (!told.isOk) {
          return err(told.error);
        }
      }
      return acked('kept');
    };

    if (isPingContentType(delivery.contentType)) {
      const ponged = await deps.door.pong(crewToken, delivery.deliveryId);
      return ponged.isOk ? ok('ponged') : err(ponged.error);
    }

    if (delivery.contentType === RELAY) {
      const relay = parsedPayload(relayPayload, delivery.payload);
      if (relay?.squadron !== squadron.id) {
        return keep();
      }
      const contact = await contactOf(deps, squadron);
      if (!contact.isOk) {
        return err(contact.error);
      }
      if (!member && !isFromContact(contact.value, delivery)) {
        return keep();
      }
      const relayed = member
        ? await relayToContact(squadron, { contact: contact.value, member, delivery, payload: relay.payload })
        : await relayFromContact(squadron, { delivery, relay });
      return relayed.isOk ? acked(relayed.value) : err(relayed.error);
    }

    if (delivery.contentType === STAND_DOWN && !member) {
      if (parsedPayload(stoodDownPayload, delivery.payload)?.squadron !== squadron.id) {
        return keep();
      }
      const allowed = await mayAsk(squadron, { delivery, ask: STANDING_DOWN_ASK });
      if (!allowed.isOk) {
        return err(allowed.error);
      }
      if (allowed.value) {
        const refused = await answerRefused(squadron, { delivery, ...allowed.value });
        return refused.isOk ? acked(refused.value) : refused;
      }
      // A stand-down that comes again finds the squadron standing down already, and gets the same answer.
      if (squadron.state !== 'standing-down') {
        const stood = await deps.standDown({ fleetId: squadron.fleetId, squadronId: squadron.id });
        if (!stood.isOk) {
          const refused = await answerRefused(squadron, { delivery, code: stood.error.kind, message: stood.error.message });
          return refused.isOk ? acked(refused.value) : refused;
        }
      }
      const answered = await deps.door.send(crewToken, {
        selector: { kind: 'ship', shipId: delivery.senderShipId },
        contentType: STANDING_DOWN,
        inReplyTo: delivery.messageId,
        idempotencyKey: `standing-down-${delivery.deliveryId}`,
        payload: JSON.stringify({ squadron: squadron.id }),
      });
      if (!answered.isOk) {
        return err(answered.error);
      }
      const handled = await acked('standing-down');
      if (handled.isOk) {
        await deps.advanceStandDowns(squadron.fleetId);
      }
      return handled;
    }

    if (delivery.contentType === ADD_MEMBER && !member) {
      const add = parsedPayload(addMemberPayload, delivery.payload);
      if (add?.squadron !== squadron.id) {
        return keep();
      }
      const allowed = await mayAsk(squadron, { delivery, ask: SCALING_ASK });
      if (!allowed.isOk) {
        return err(allowed.error);
      }
      if (allowed.value) {
        const refused = await answerRefused(squadron, { delivery, ...allowed.value });
        return refused.isOk ? acked(refused.value) : refused;
      }
      // A request that comes again from its sender under its key finds the member it added, and gets the same answer.
      const repeated = squadron.members.find((each) => each.addRequest?.by === delivery.senderShipId && each.addRequest.key === add.key);
      let added: { name: string; role: string } | undefined = repeated && { name: repeated.name, role: repeated.role };
      if (!added) {
        const adding = await deps.addMember({
          fleetId: squadron.fleetId,
          squadronId: squadron.id,
          role: add.role,
          ...(add.parameters === undefined ? {} : { member: { parameters: add.parameters } }),
          byMessage: { by: delivery.senderShipId, key: add.key },
        });
        if (!adding.isOk) {
          const refused = await answerRefused(squadron, { delivery, code: adding.error.kind, message: adding.error.message });
          return refused.isOk ? acked(refused.value) : refused;
        }
        added = { name: adding.value.name, role: adding.value.role };
      }
      const answered = await deps.door.send(crewToken, {
        selector: { kind: 'ship', shipId: delivery.senderShipId },
        contentType: MEMBER_ADDED,
        inReplyTo: delivery.messageId,
        idempotencyKey: `member-added-${delivery.deliveryId}`,
        payload: JSON.stringify({ squadron: squadron.id, key: add.key, member: { name: added.name, role: added.role } }),
      });
      return answered.isOk ? acked('member-added') : err(answered.error);
    }

    if (delivery.contentType === REMOVE_MEMBER && !member) {
      const remove = parsedPayload(removeMemberPayload, delivery.payload);
      if (remove?.squadron !== squadron.id) {
        return keep();
      }
      const allowed = await mayAsk(squadron, { delivery, ask: SCALING_ASK });
      if (!allowed.isOk) {
        return err(allowed.error);
      }
      const removing = squadron.members.find((each) => each.name === remove.member);
      const refusal = allowed.value ?? (removing ? undefined : { code: 'NO_SUCH_MEMBER', message: `The squadron ${squadron.id} has no member ${remove.member}` });
      if (refusal) {
        const refused = await answerRefused(squadron, { delivery, ...refusal });
        return refused.isOk ? acked(refused.value) : refused;
      }
      // A member removed already, retired or being released, is answered removed again and changes nothing.
      if (removing?.retiredAt === null && removing.releasingSince === null) {
        const removed = await deps.removeMember({ fleetId: squadron.fleetId, squadronId: squadron.id, shipId: removing.shipId });
        if (!removed.isOk) {
          const refused = await answerRefused(squadron, { delivery, code: removed.error.kind, message: removed.error.message });
          return refused.isOk ? acked(refused.value) : refused;
        }
      }
      const answered = await deps.door.send(crewToken, {
        selector: { kind: 'ship', shipId: delivery.senderShipId },
        contentType: MEMBER_REMOVED,
        inReplyTo: delivery.messageId,
        idempotencyKey: `member-removed-${delivery.deliveryId}`,
        payload: JSON.stringify({ squadron: squadron.id, member: remove.member }),
      });
      return answered.isOk ? acked('member-removed') : err(answered.error);
    }

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

    if (delivery.contentType === STOOD_DOWN) {
      const stoodDown = parsedPayload(stoodDownPayload, delivery.payload);
      if (!member || stoodDown?.squadron !== squadron.id || squadron.state !== 'standing-down') {
        return keep();
      }
      if (member.stoodDownAt === null) {
        const at = deps.clock.now();
        await deps.squadrons.update({
          before: squadron,
          after: { ...squadron, members: squadron.members.map((each) => (each.shipId === member.shipId ? { ...each, stoodDownAt: at } : each)) },
        });
      }
      // Acked before the stand-downs advance: retiring the last member retires the flagship, which could ack no more.
      const handled = await acked('stood-down');
      if (handled.isOk) {
        await deps.advanceStandDowns(squadron.fleetId);
      }
      return handled;
    }

    return keep();
  };
}
