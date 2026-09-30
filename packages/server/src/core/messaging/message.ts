import type { DeliveryId, DeliveryState, FleetId, LeaseId, MessageId, ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Recipient } from '../shared/selector.js';

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
  /** The selector as resolved at send time: a ship's id, never its name, or a type. */
  selector: Recipient;
  payload: string;
  /** A media type, exactly as the sender gave it. */
  contentType: string;
  /** Unique per sender: a repeat of the same request returns this message instead of storing a new one. */
  idempotencyKey: string;
  /** The hash of the request the message was sent with: what a repeat of its key must match. */
  requestHash: string;
  /** The message of the same fleet this one replies to. */
  inReplyToMessageId: MessageId | null;
  createdAt: Date;
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
  /** How many times a receive claimed it. */
  attempts: number;
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
  idempotencyKey: string;
  requestHash: string;
  inReplyTo: MessageId | undefined;
  at: Date;
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

export type AcceptRefusal = DomainError<'IN_REPLY_TO_NOT_FOUND'>;

/**
 * Accepts a message: the message, its one pending delivery to the recipient
 * its selector resolved to, and MessageAccepted, caused by the sender. A reply
 * names a message of the same fleet: `repliedTo` is that message as the fleet
 * holds it, if it does.
 */
export function acceptMessage(
  fleet: { recipient: Recipient; repliedTo: Message | undefined },
  send: MessageToAccept,
): Result<{ message: Message; delivery: Delivery; events: NewEvent[] }, AcceptRefusal> {
  const { recipient, repliedTo } = fleet;
  const { messageId, deliveryId, fleetId, senderShipId, inReplyTo, at } = send;
  if (inReplyTo !== undefined && repliedTo?.id !== inReplyTo) {
    return refuse('IN_REPLY_TO_NOT_FOUND', `Message ${inReplyTo} does not exist: a reply names a message of the fleet`);
  }

  const message: Message = {
    id: messageId,
    fleetId,
    senderShipId,
    selector: recipient,
    payload: send.payload,
    contentType: send.contentType,
    idempotencyKey: send.idempotencyKey,
    requestHash: send.requestHash,
    inReplyToMessageId: inReplyTo ?? null,
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
        actor: shipActor(senderShipId),
        shipId: recipient.kind === 'ship' ? recipient.shipId : undefined,
        messageId,
        deliveryId,
        details: { selector: recipient.kind, recipientType: recipient.kind === 'type' ? recipient.type : null },
      },
    ],
  });
}
