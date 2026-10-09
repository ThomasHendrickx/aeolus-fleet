import { isPingContentType, type DeliveryId, type DeliveryState, type FleetId, type LeaseId, type MessageId, type ShipId, type ShipKind } from '@aeolus-fleet/common';

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
  /**
   * For a type, under network rules: the ships of the type its sender may
   * reach, fixed at send time; only they may claim it (decision 0033).
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
  /** Whether the sender is argo or an agent ship, for the model rule; a resend carries none, as it keeps the original's model. */
  senderKind?: ShipKind;
  idempotencyKey: string;
  requestHash: string;
  inReplyTo: MessageId | undefined;
  /**
   * For a resend: the message it resends and the ship that resent it, the
   * operator. The sender stays the original one, so an answer goes back to
   * whoever asked; the operator is the actor of MessageAccepted.
   */
  resendOf?: { messageId: MessageId; by: ShipId };
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

export type AcceptRefusal = DomainError<'IN_REPLY_TO_NOT_FOUND' | 'MODEL_REQUIRED' | 'MODEL_FROM_ARGO'>;

/**
 * Accepts a message: the message, its one pending delivery to the recipient
 * its selector resolved to, and MessageAccepted, caused by the sender. A reply
 * names a message of the same fleet: `repliedTo` is that message as the fleet
 * holds it, if it does. Every ship but argo states the model its session
 * runs (docs/blueprint.md, "Model"); argo states none. A resend carries the
 * original message's model as it was, so it is not asked again; a ping is the
 * fleet's question, not a session's message, so it carries none. A type
 * delivery the network rules limit to some ships of the type keeps them.
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
  const isStated = resendOf === undefined && !isPingContentType(send.contentType);
  if (isStated && send.senderKind === 'operator' && send.model !== undefined) {
    return refuse('MODEL_FROM_ARGO', 'argo states no model: send without one');
  }
  if (isStated && send.senderKind !== 'operator' && send.model === undefined) {
    return refuse('MODEL_REQUIRED', 'send needs model: the exact model id this session runs, such as claude-opus-5-5');
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
        actor: shipActor(resendOf?.by ?? senderShipId),
        shipId: recipient.kind === 'ship' ? recipient.shipId : undefined,
        messageId,
        deliveryId,
        details: {
          selector: recipient.kind,
          recipientType: recipient.kind === 'type' ? recipient.type : null,
          model: send.model ?? null,
          ...(resendOf && { resendOf: resendOf.messageId }),
        },
      },
    ],
  });
}
