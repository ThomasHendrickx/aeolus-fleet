import type { IdGenerator, MessageId } from '@aeolus-fleet/common';

import { resolveSelector, type ResolveSelectorTx, type UnresolvableSelector } from '../registry/public.js';
import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import type { Notifier } from '../shared/notifier.js';
import { ok, type Result } from '../shared/result.js';
import type { Selector } from '../shared/selector.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { contentType } from './content-type.js';
import { idempotencyKey } from './idempotency-key.js';
import { acceptMessage, repeatOf, type AcceptRefusal, type RepeatRefusal } from './message.js';
import { payload } from './payload.js';
import type { DeliveryRepository, MessageRepository, RequestHasher } from './ports.js';
import { sendRequestText } from './send-request.js';

export interface SendMessageTx extends ResolveSelectorTx {
  messages: MessageRepository;
  deliveries: DeliveryRepository;
  events: EventLog;
  notifier: Notifier;
}

export interface MessageToSend {
  selector: Selector;
  payload: string;
  /** Any well-formed media type, passed on untouched; text/plain when the sender gives none. */
  contentType?: string;
  idempotencyKey: string;
  /** The id of the message, in the same fleet, this one replies to. */
  inReplyTo?: MessageId;
}

export interface MessageSent {
  /** The message's id: the original one when the sender used the idempotency key before. */
  messageId: MessageId;
}

export type SendMessageRefusal =
  | DomainError<'PAYLOAD_TOO_LARGE' | 'INVALID_CONTENT_TYPE' | 'INVALID_IDEMPOTENCY_KEY'>
  | RepeatRefusal
  | UnresolvableSelector
  | AcceptRefusal;

export type SendMessage = (caller: Caller, input: MessageToSend) => Promise<Result<MessageSent, SendMessageRefusal>>;

/**
 * Use case: the calling ship sends a message (`send`). The sender is always
 * the caller, `argo` included; its scope (messages:send) is checked before
 * this runs. The message, its delivery, MessageAccepted and the notice that
 * wakes its receivers are one unit of work: the sender gets its id only once
 * all of it is committed (ADR 0003). A payload over 64 KB, a content type that
 * is no media type or a bad key is refused before the unit of work starts, so
 * nothing is stored. Without a content type the message is text/plain: the
 * same request as one that names text/plain.
 *
 * A repeat, the same sender with the same idempotency key and the same
 * request, returns the original message's id and stores nothing; the same key
 * with another request is refused. The key is checked before the selector, so
 * a retry still gets its OK after the recipient was retired. Locks, in this
 * order: the sender's key, so two sends with one key take turns and the second
 * finds the first one's message; then the ship the message is addressed to,
 * held against a retire.
 */
export function createSendMessage(deps: {
  uow: UnitOfWork<SendMessageTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: RequestHasher;
}): SendMessage {
  return async (caller, input) => {
    const request = checkedSend(input, deps.hasher);
    if (!request.isOk) {
      return request;
    }
    return deps.uow.run((tx) => sendWithin({ tx, clock: deps.clock, ids: deps.ids }, { caller, request: request.value }));
  };
}

/** A send whose payload, content type and key were checked, with the hash of its request. */
export interface CheckedSend {
  selector: Selector;
  payload: string;
  contentType: string;
  idempotencyKey: string;
  inReplyTo: MessageId | undefined;
  requestHash: string;
}

/**
 * Checks what a send asks for before any unit of work starts, so a refusal
 * stores nothing: the payload, the content type (text/plain when none is
 * given) and the key; and hashes the request.
 */
export function checkedSend(input: MessageToSend, hasher: RequestHasher): Result<CheckedSend, SendMessageRefusal> {
  const text = payload(input.payload);
  if (!text.isOk) {
    return text;
  }
  const mediaType = contentType(input.contentType);
  if (!mediaType.isOk) {
    return mediaType;
  }
  const key = idempotencyKey(input.idempotencyKey);
  if (!key.isOk) {
    return key;
  }
  const { selector, inReplyTo } = input;
  const requestHash = hasher.hash(
    sendRequestText({ selector, payload: text.value, contentType: mediaType.value, inReplyTo }),
  );
  return ok({ selector, payload: text.value, contentType: mediaType.value, idempotencyKey: key.value, inReplyTo, requestHash });
}

/** Sends a checked request inside the caller's unit of work, as {@link createSendMessage} describes. */
export async function sendWithin(
  deps: { tx: SendMessageTx; clock: Clock; ids: IdGenerator },
  send: { caller: Caller; request: CheckedSend },
): Promise<Result<MessageSent, SendMessageRefusal>> {
  const { tx, clock, ids } = deps;
  const { fleetId, shipId: senderShipId } = send.caller;
  const { selector, inReplyTo, requestHash } = send.request;
  const senderKey = { fleetId, senderShipId, idempotencyKey: send.request.idempotencyKey };
  await tx.messages.lockIdempotencyKey(senderKey);
  const original = await tx.messages.findByIdempotencyKey(senderKey);
  if (original) {
    const repeat = repeatOf(original, requestHash);
    return repeat.isOk ? ok({ messageId: repeat.value }) : repeat;
  }

  const recipient = await resolveSelector(tx, { fleetId, selector });
  if (!recipient.isOk) {
    return recipient;
  }
  const repliedTo = inReplyTo === undefined ? undefined : await tx.messages.find(fleetId, inReplyTo);
  const accepted = acceptMessage(
    { recipient: recipient.value, repliedTo },
    {
      messageId: ids('message'),
      deliveryId: ids('delivery'),
      fleetId,
      senderShipId,
      payload: send.request.payload,
      contentType: send.request.contentType,
      idempotencyKey: send.request.idempotencyKey,
      requestHash,
      inReplyTo,
      at: clock.now(),
    },
  );
  if (!accepted.isOk) {
    return accepted;
  }

  const { message, delivery, events } = accepted.value;
  await tx.messages.create(message);
  await tx.deliveries.create(delivery);
  for (const event of events) {
    await recordEvent({ events: tx.events, ids }, event);
  }
  await tx.notifier.deliveryPending({ fleetId, deliveryId: delivery.id, recipient: delivery.recipient });
  return ok({ messageId: message.id });
}
