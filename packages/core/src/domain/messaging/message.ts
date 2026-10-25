import { isPingContentType, type AccountId, type DeliveryId, type DeliveryState, type FleetId, type LabelValueId, type LeaseId, type MeetingId, type MessageId, type ScheduleId, type ShipId, type ShipKind } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor, type Actor, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Addressee, LabelSelector, Recipient } from '../shared/selector.js';

/**
 * An immutable envelope plus an opaque payload, sent by one ship to a
 * selector (docs/blueprint.md, "Message"). Accepted only once its selector
 * resolved to a ship that is not retired, or to a type with one.
 */
export interface Message {
  id: MessageId;
  fleetId: FleetId;
  /** The calling ship: every sender is a ship, `argo` included. */
  senderShipId: ShipId;
  /** The selector as resolved at send time: a ship's id, never its name, a type, a meeting (decision 0061), or a label selection as sent (decision 0065). */
  selector: Addressee;
  payload: string;
  /** A media type, exactly as the sender gave it. */
  contentType: string;
  /** The model the sender's session stated it runs; none from argo, and none on messages from before models were stated. */
  model: string | null;
  /** Unique per sender: a repeat of the same request returns this message instead of storing a new one. */
  idempotencyKey: string;
  /** The hash of the request the message was sent with: what a repeat of its key must match. */
  requestHash: string;
  /** The message of the same fleet this one replies to. */
  inReplyToMessageId: MessageId | null;
  /** The message this one resends: an undeliverable one the operator sent again. */
  resendOfMessageId: MessageId | null;
  /** The meeting it was contributed to, or tells of as the notice that added its recipient (decision 0061). */
  meetingId: MeetingId | null;
  /** The schedule it was sent for, and that send time; none on a live send (decision 0062). */
  scheduleId: ScheduleId | null;
  sendTime: Date | null;
  createdAt: Date;
}

/** The schedule a message is sent for, and the send time it is sent at (decision 0062). */
export interface ScheduledFor {
  scheduleId: ScheduleId;
  sendTime: Date;
}

/**
 * One message to one resolved recipient, with its own state. Pending until a
 * ship receives it; for a type, the first ship of that type to receive it
 * claims it.
 */
export interface Delivery {
  id: DeliveryId;
  fleetId: FleetId;
  messageId: MessageId;
  recipient: Recipient;
  state: DeliveryState;
  /**
   * The ship and the lease of the crew whose receive claimed it: set while it
   * is in flight, kept once acknowledged, none while it is pending.
   */
  claimedByShipId: ShipId | null;
  claimedByLeaseId: LeaseId | null;
  /** How many times it was handed over: once per plain receive, or once per new hand-over number on a pushed ship. */
  attempts: number;
  /**
   * The last hand-over number its crew reported with handed: a repeat of it,
   * or a lower one, changes nothing. None until a push receive's crew hands it
   * over, and none again once it returns to pending.
   */
  handOverNumber: number | null;
  /**
   * When its crew handed it once more, after the turn that took it died
   * (decision 0040): only once, so none until then.
   */
  handedOnceMoreAt: Date | null;
  /** Whether its message was forced (decision 0040): it comes first in receive and push receive. */
  isForced: boolean;
  /**
   * For a type, under network rules: the ships of the type its sender may
   * reach, fixed at send time; only they may claim it (decision 0034).
   * Absent, any ship of the type may. Written at send; a claim's query reads
   * it, so a delivery read back for a change may leave it out.
   */
  reachableShipIds?: readonly ShipId[];
  createdAt: Date;
}

/** What the sender asked for, its payload and key already checked. */
export interface MessageToAccept {
  messageId: MessageId;
  deliveryId: DeliveryId;
  fleetId: FleetId;
  senderShipId: ShipId;
  payload: string;
  contentType: string;
  /** The model the sender states; a resend carries the original's. */
  model: string | undefined;
  /** The sender's kind, for the model rule (only an agent states one); a resend carries none, as it keeps the original's model. */
  senderKind?: ShipKind;
  idempotencyKey: string;
  requestHash: string;
  inReplyTo: MessageId | undefined;
  /** A forced send (decision 0040): its delivery comes first. */
  isForced: boolean;
  /**
   * For a resend: the message it resends. The sender stays the original one,
   * so an answer goes back to whoever asked.
   */
  resendOf?: { messageId: MessageId };
  /** Who caused MessageAccepted when it is not the sender: the actor resending it, or an account pinging as argo. */
  actor?: Actor;
  /** The account signed in to the console as argo when argo sends or resends it (decision 0054). */
  signedInAccountId?: AccountId;
  /** The meeting it tells of, for the notice that adds its recipient to one (decision 0061). */
  meetingId?: MeetingId;
  /** The schedule it is sent for, and that send time (decision 0062). */
  scheduledFor?: ScheduledFor;
  at: Date;
}

/**
 * Who the delivery of the message went to: its message's recipient, or for a
 * contribution to a meeting (decision 0061) or a send to a label (decision
 * 0065) the ship it is for.
 */
export function deliveredTo(message: Pick<Message, 'selector'>, delivery: Pick<Delivery, 'recipient'>): Recipient {
  return message.selector.kind === 'meeting' || message.selector.kind === 'label' ? delivery.recipient : message.selector;
}

export type RepeatRefusal = DomainError<'IDEMPOTENCY_KEY_REUSED'>;

/**
 * A send with a key its sender used before. The same request is a repeat, a
 * retry, and gets the original message's id; another request with that key is
 * refused, so one key never stands for two messages.
 */
export function repeatOf(original: Message, requestHash: string): Result<MessageId, RepeatRefusal> {
  return original.requestHash === requestHash
    ? ok(original.id)
    : refuse(
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was already used for another message: send a new message with a new key',
      );
}

export type AcceptRefusal = DomainError<'IN_REPLY_TO_NOT_FOUND' | 'MODEL_REQUIRED' | 'MODEL_FROM_ARGO' | 'MODEL_FROM_PERSON_APP_OR_PLUGIN'>;

/**
 * Accepts a message: the message, its one pending delivery to the recipient
 * its selector resolved to, and MessageAccepted, caused by the sender. A reply
 * names a message of the same fleet: `repliedTo` is that message as the fleet
 * holds it, if it does. Only an agent ship states the model its session
 * runs (decisions 0018 and 0044); argo, a person, an app and a plugin state none (decision 0050). A resend carries the
 * original message's model as it was, so it is not asked again; a ping is the
 * fleet's question, not a session's message, so it carries none. A type
 * delivery the network rules limit to some ships of the type keeps them. A
 * forced send's delivery records that it was forced, and MessageAccepted
 * says so.
 */
export function acceptMessage(
  fleet: { recipient: Recipient; repliedTo: Message | undefined; reachableShipIds?: readonly ShipId[] },
  send: MessageToAccept,
): Result<{ message: Message; delivery: Delivery; events: NewEvent[] }, AcceptRefusal> {
  const { recipient, repliedTo, reachableShipIds } = fleet;
  const { messageId, deliveryId, fleetId, senderShipId, inReplyTo, resendOf, at } = send;
  if (inReplyTo !== undefined && repliedTo?.id !== inReplyTo) {
    return refuse('IN_REPLY_TO_NOT_FOUND', `Message ${inReplyTo} does not exist: a reply names a message of the fleet`);
  }
  const stated = checkModel(send);
  if (!stated.isOk) {
    return stated;
  }

  const message: Message = {
    id: messageId,
    fleetId,
    senderShipId,
    selector: recipient,
    payload: send.payload,
    contentType: send.contentType,
    model: send.model ?? null,
    idempotencyKey: send.idempotencyKey,
    requestHash: send.requestHash,
    inReplyToMessageId: inReplyTo ?? null,
    resendOfMessageId: resendOf?.messageId ?? null,
    meetingId: send.meetingId ?? null,
    scheduleId: send.scheduledFor?.scheduleId ?? null,
    sendTime: send.scheduledFor?.sendTime ?? null,
    createdAt: at,
  };
  const delivery: Delivery = {
    id: deliveryId,
    fleetId,
    messageId,
    recipient,
    state: 'pending',
    claimedByShipId: null,
    claimedByLeaseId: null,
    attempts: 0,
    handOverNumber: null,
    handedOnceMoreAt: null,
    isForced: send.isForced,
    ...(reachableShipIds && { reachableShipIds: [...reachableShipIds] }),
    createdAt: at,
  };
  return ok({
    message,
    delivery,
    events: [
      {
        fleetId,
        type: 'MessageAccepted',
        occurredAt: at,
        actor: send.actor ?? (send.signedInAccountId === undefined ? shipActor(senderShipId) : { kind: 'ship', shipId: senderShipId, signedInAccountId: send.signedInAccountId }),
        shipId: recipient.kind === 'ship' ? recipient.shipId : undefined,
        messageId,
        deliveryId,
        details: {
          selector: recipient.kind,
          recipientType: recipient.kind === 'type' ? recipient.type : null,
          model: send.model ?? null,
          ...(resendOf && { resendOf: resendOf.messageId }),
          ...(send.isForced && { forced: true }),
          ...(send.meetingId && { meetingId: send.meetingId }),
          ...(send.scheduledFor && { scheduleId: send.scheduledFor.scheduleId, sendTime: send.scheduledFor.sendTime.toISOString() }),
        },
      },
    ],
  });
}

/**
 * The model rule: only an agent ship states the model its session runs
 * (decisions 0018, 0044 and 0050); a resend carries the original's and a
 * ping none, so neither is asked.
 */
export function checkModel(send: Pick<MessageToAccept, 'resendOf' | 'contentType' | 'senderKind' | 'model'>): Result<undefined, AcceptRefusal> {
  const isStated = send.resendOf === undefined && !isPingContentType(send.contentType);
  if (isStated && send.senderKind === 'operator' && send.model !== undefined) {
    return refuse('MODEL_FROM_ARGO', 'argo states no model: send without one');
  }
  if (isStated && (send.senderKind === 'person' || send.senderKind === 'app' || send.senderKind === 'plugin') && send.model !== undefined) {
    return refuse('MODEL_FROM_PERSON_APP_OR_PLUGIN', `A ${send.senderKind} ship states no model: send without one`);
  }
  if (isStated && send.senderKind === 'agent' && send.model === undefined) {
    return refuse('MODEL_REQUIRED', 'send needs model: the exact model id this session runs, such as claude-opus-5-5');
  }
  return ok(undefined);
}

/** What a participant contributes to a meeting, its payload and key already checked, with one delivery id per participant it goes to. */
export type ContributionToAccept = Omit<MessageToAccept, 'deliveryId' | 'inReplyTo' | 'isForced' | 'resendOf' | 'meetingId' | 'scheduledFor'> & {
  meetingId: MeetingId;
  deliveries: readonly { deliveryId: DeliveryId; shipId: ShipId }[];
};

/**
 * Accepts a contribution to a meeting (decision 0061): one message to the
 * meeting, carrying it on its envelope, and one pending delivery per other
 * participant, each with its own MessageAccepted naming that participant and
 * the meeting, caused by the sender. The model rule is a send's.
 */
export function acceptContribution(send: ContributionToAccept): Result<{ message: Message; deliveries: Delivery[]; events: NewEvent[] }, AcceptRefusal> {
  const { messageId, fleetId, senderShipId, meetingId, at } = send;
  const stated = checkModel(send);
  if (!stated.isOk) {
    return stated;
  }
  const message: Message = {
    id: messageId,
    fleetId,
    senderShipId,
    selector: { kind: 'meeting', meetingId },
    payload: send.payload,
    contentType: send.contentType,
    model: send.model ?? null,
    idempotencyKey: send.idempotencyKey,
    requestHash: send.requestHash,
    inReplyToMessageId: null,
    resendOfMessageId: null,
    meetingId,
    scheduleId: null,
    sendTime: null,
    createdAt: at,
  };
  const deliveries = send.deliveries.map(
    ({ deliveryId, shipId }): Delivery => ({
      id: deliveryId,
      fleetId,
      messageId,
      recipient: { kind: 'ship', shipId },
      state: 'pending',
      claimedByShipId: null,
      claimedByLeaseId: null,
      attempts: 0,
      handOverNumber: null,
      handedOnceMoreAt: null,
      isForced: false,
      createdAt: at,
    }),
  );
  const actor = send.signedInAccountId === undefined ? shipActor(senderShipId) : { kind: 'ship' as const, shipId: senderShipId, signedInAccountId: send.signedInAccountId };
  return ok({
    message,
    deliveries,
    events: send.deliveries.map(({ deliveryId, shipId }): NewEvent => ({
      fleetId,
      type: 'MessageAccepted',
      occurredAt: at,
      actor,
      shipId,
      messageId,
      deliveryId,
      details: { selector: 'meeting', recipientType: null, model: send.model ?? null, meetingId },
    })),
  });
}

/** A send to a label selection, its payload and key already checked, with one delivery id per ship the selection resolved to (decision 0065). */
export type LabelMessageToAccept = Omit<MessageToAccept, 'deliveryId' | 'resendOf' | 'meetingId'> & {
  valueIds: readonly LabelValueId[];
  deliveries: readonly { deliveryId: DeliveryId; shipId: ShipId }[];
};

/**
 * Accepts a send to a label selection (decision 0065): one message keeping
 * the selection as sent, and one pending delivery per ship it resolved to,
 * each with its own MessageAccepted naming that ship, caused by the sender.
 * The reply, model and force rules are a send's.
 */
export function acceptLabelMessage(
  repliedTo: Message | undefined,
  send: LabelMessageToAccept,
): Result<{ message: Message; deliveries: Delivery[]; events: NewEvent[] }, AcceptRefusal> {
  const { messageId, fleetId, senderShipId, inReplyTo, at } = send;
  if (inReplyTo !== undefined && repliedTo?.id !== inReplyTo) {
    return refuse('IN_REPLY_TO_NOT_FOUND', `Message ${inReplyTo} does not exist: a reply names a message of the fleet`);
  }
  const stated = checkModel(send);
  if (!stated.isOk) {
    return stated;
  }
  const selector: LabelSelector = { kind: 'label', valueIds: [...send.valueIds] };
  const message: Message = {
    id: messageId,
    fleetId,
    senderShipId,
    selector,
    payload: send.payload,
    contentType: send.contentType,
    model: send.model ?? null,
    idempotencyKey: send.idempotencyKey,
    requestHash: send.requestHash,
    inReplyToMessageId: inReplyTo ?? null,
    resendOfMessageId: null,
    meetingId: null,
    scheduleId: send.scheduledFor?.scheduleId ?? null,
    sendTime: send.scheduledFor?.sendTime ?? null,
    createdAt: at,
  };
  const deliveries = send.deliveries.map(
    ({ deliveryId, shipId }): Delivery => ({
      id: deliveryId,
      fleetId,
      messageId,
      recipient: { kind: 'ship', shipId },
      state: 'pending',
      claimedByShipId: null,
      claimedByLeaseId: null,
      attempts: 0,
      handOverNumber: null,
      handedOnceMoreAt: null,
      isForced: send.isForced,
      createdAt: at,
    }),
  );
  const actor = send.signedInAccountId === undefined ? shipActor(senderShipId) : { kind: 'ship' as const, shipId: senderShipId, signedInAccountId: send.signedInAccountId };
  return ok({
    message,
    deliveries,
    events: send.deliveries.map(({ deliveryId, shipId }): NewEvent => ({
      fleetId,
      type: 'MessageAccepted',
      occurredAt: at,
      actor: send.actor ?? actor,
      shipId,
      messageId,
      deliveryId,
      details: {
        selector: 'label',
        recipientType: null,
        model: send.model ?? null,
        ...(send.isForced && { forced: true }),
        ...(send.scheduledFor && { scheduleId: send.scheduledFor.scheduleId, sendTime: send.scheduledFor.sendTime.toISOString() }),
      },
    })),
  });
}
