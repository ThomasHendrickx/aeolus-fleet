import { isPingContentType, PING_CONTENT_TYPE, type IdGenerator, type MessageId } from '@aeolus-fleet/common';

import { checkReach, resolveSelector, type CheckReachTx, type NotReachable, type ResolveSelectorTx, type UnresolvableSelector } from '../registry/public.js';
import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import type { Notifier } from '../shared/notifier.js';
import { err, ok, type Result } from '../shared/result.js';
import { isAnswerToSender } from './answer.js';
import type { Selector } from '../shared/selector.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { contentType } from './content-type.js';
import { withinDailyMessageLimit, type DailyMessageLimitTx } from './daily-message-limit.js';
import { idempotencyKey } from '../shared/idempotency-key.js';
import { acceptMessage, repeatOf, type AcceptRefusal, type RepeatRefusal } from './message.js';
import { payload } from './payload.js';
import type { DeliveryRepository, MessageRepository, RequestHasher } from './ports.js';
import { sendRequestText } from './send-request.js';

export interface SendMessageTx extends Omit<ResolveSelectorTx, 'ships'>, Omit<CheckReachTx, 'ships'>, DailyMessageLimitTx {
  ships: ResolveSelectorTx['ships'] & CheckReachTx['ships'];
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
  /** The exact model the sender's session runs: every ship but argo states it. */
  model?: string;
  idempotencyKey: string;
  /** The id of the message, in the same fleet, this one replies to. */
  inReplyTo?: MessageId;
}

export interface MessageSent {
  /** The message's id: the original one when the sender used the idempotency key before. */
  messageId: MessageId;
}

export type SendMessageRefusal =
  | DomainError<'PAYLOAD_TOO_LARGE' | 'INVALID_CONTENT_TYPE' | 'INVALID_IDEMPOTENCY_KEY' | 'RESERVED_CONTENT_TYPE'>
  | RepeatRefusal
  | UnresolvableSelector
  | AcceptRefusal
  | NotReachable
  | DomainError<'MESSAGE_LIMIT_REACHED'>;

export type SendMessage = (caller: Caller, input: MessageToSend) => Promise<Result<MessageSent, SendMessageRefusal>>;

/**
 * Use case: the calling ship sends a message (`send`). The sender is always
 * the caller, `argo` included; its scope (messages:send) is checked before
 * this runs. The message, its delivery, MessageAccepted and the notice that
 * wakes its receivers are one unit of work: the sender gets its id only once
 * all of it is committed (ADR 0003). A payload over 64 KB, a content type that
 * is no media type or a bad key is refused before the unit of work starts, so
 * nothing is stored. Without a content type the message is text/plain: the
 * same request as one that names text/plain. The ping content type is
 * reserved: only the ping call sends one, so pings never stack. Every ship but
 * argo states its model; the model is no part of the request, so a retry
 * after the session switched model is still a repeat.
 *
 * A repeat, the same sender with the same idempotency key and the same
 * request, returns the original message's id and stores nothing; the same key
 * with another request is refused. The key is checked before the selector, so
 * a retry still gets its OK after the recipient was retired. Locks, in this
 * order: the sender's key, so two sends with one key take turns and the second
 * finds the first one's message; then the ship the message is addressed to,
 * held against a retire; then the fleet's network settings, held shared
 * against a change of rules.
 *
 * With network rules set, a send no rule allows is refused (decision 0033):
 * its unit of work commits only the refusal's record, and the sender gets a
 * refusal without reasons. argo, and an answer to the sender of a message the
 * ship received, always go through.
 */
export function createSendMessage(deps: {
  uow: UnitOfWork<SendMessageTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: RequestHasher;
}): SendMessage {
  return async (caller, input) => {
    if (input.contentType !== undefined && isPingContentType(input.contentType)) {
      return refuse('RESERVED_CONTENT_TYPE', `${PING_CONTENT_TYPE} is reserved for pings: ping a ship from the console`);
    }
    const request = checkedSend(input, deps.hasher);
    if (!request.isOk) {
      return request;
    }
    const outcome = await deps.uow.run(async (tx): Promise<Result<MessageSent | { prevented: NotReachable }, SendMessageRefusal>> => {
      const sent = await sendWithin({ tx, clock: deps.clock, ids: deps.ids }, { caller, request: request.value });
      // A send the network rules refused stored only its refusal's record: committed, then refused.
      return !sent.isOk && sent.error.kind === 'NOT_REACHABLE' ? ok({ prevented: sent.error }) : sent;
    });
    if (!outcome.isOk) {
      return outcome;
    }
    return 'prevented' in outcome.value ? err(outcome.value.prevented) : ok(outcome.value);
  };
}

/** A send whose payload, content type and key were checked, with the hash of its request. */
export interface CheckedSend {
  selector: Selector;
  payload: string;
  contentType: string;
  model: string | undefined;
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
  return ok({ selector, payload: text.value, contentType: mediaType.value, model: input.model, idempotencyKey: key.value, inReplyTo, requestHash });
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
  const at = clock.now();
  const repliedTo = inReplyTo === undefined ? undefined : await tx.messages.find(fleetId, inReplyTo);
  const repliedDelivery = repliedTo && (await tx.deliveries.findOfMessage(fleetId, repliedTo.id));
  const reach = await checkReach(
    { tx, ids },
    {
      fleetId,
      senderShipId,
      recipient: recipient.value,
      isAnswerToSender: isAnswerToSender({ senderShipId, recipient: recipient.value }, repliedTo && repliedDelivery && { message: repliedTo, delivery: repliedDelivery }),
      at,
    },
  );
  if (!reach.isOk) {
    return reach;
  }
  const withinLimit = await withinDailyMessageLimit(tx, { fleetId, time: at });
  if (!withinLimit.isOk) {
    return withinLimit;
  }
  const accepted = acceptMessage(
    { recipient: recipient.value, repliedTo },
    {
      messageId: ids('message'),
      deliveryId: ids('delivery'),
      fleetId,
      senderShipId,
      payload: send.request.payload,
      contentType: send.request.contentType,
      model: send.request.model,
      senderKind: send.caller.kind,
      idempotencyKey: send.request.idempotencyKey,
      requestHash,
      inReplyTo,
      at,
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
