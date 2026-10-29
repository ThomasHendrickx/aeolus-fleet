import { isPingContentType, PING_CONTENT_TYPE, SCHEDULE_IDEMPOTENCY_KEY_PREFIX, type IdGenerator, type MessageId, type ShipId } from '@aeolus-fleet/common';

import {
  checkReach,
  resolveLabelSelection,
  resolveSelector,
  type CheckReachTx,
  type NotReachable,
  type ResolveLabelSelectionTx,
  type ResolveSelectorTx,
  type UnresolvableSelector,
} from '../registry/public.js';
import { hasScope, type ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type Actor, type EventLog } from '../shared/events.js';
import type { Notifier } from '../shared/notifier.js';
import { err, ok, type Result } from '../shared/result.js';
import { isAnswerToSender } from './answer.js';
import type { LabelSelector, MeetingSelector, Selector } from '../shared/selector.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkReachToEach } from './check-reach-to-each.js';
import { contentType } from './content-type.js';
import { withinDailyMessageLimit, type DailyMessageLimitTx } from './daily-message-limit.js';
import { idempotencyKey } from '../shared/idempotency-key.js';
import { acceptContribution, acceptLabelMessage, acceptMessage, repeatOf, type AcceptRefusal, type RepeatRefusal, type ScheduledFor } from './message.js';
import { payload } from './payload.js';
import type { DeliveryRepository, FleetSealingRepository, MeetingRepository, MessageRepository, RequestHasher } from './ports.js';
import { sealedMessage, unsealed, withDataKeys, type DataKeysNeeded, type HeldDataKeys, type PayloadSealing } from './data-keys.js';
import type { Message } from './message.js';
import { checkContribution, type ContributionRefusal } from './meeting.js';
import { sendRequestText } from './send-request.js';

export interface SendMessageTx extends Omit<ResolveSelectorTx, 'ships'>, Omit<CheckReachTx, 'ships'>, DailyMessageLimitTx {
  ships: ResolveSelectorTx['ships'] & CheckReachTx['ships'] & ResolveLabelSelectionTx['ships'];
  messages: MessageRepository;
  deliveries: DeliveryRepository;
  meetings: Pick<MeetingRepository, 'findForShare'>;
  sealings: Pick<FleetSealingRepository, 'currentDataKeyId'>;
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
  /** A forced send: act now (decision 0040). It needs messages:force, and its delivery comes first. */
  isForced?: boolean;
}

export interface MessageSent {
  /** The message's id: the original one when the sender used the idempotency key before. */
  messageId: MessageId;
}

export type SendMessageRefusal =
  | DomainError<'PAYLOAD_TOO_LARGE' | 'INVALID_CONTENT_TYPE' | 'INVALID_IDEMPOTENCY_KEY' | 'RESERVED_CONTENT_TYPE' | 'FORCE_NOT_ALLOWED'>
  | RepeatRefusal
  | UnresolvableSelector
  | AcceptRefusal
  | NotReachable
  | ContributionRefusal
  | DomainError<'MESSAGE_LIMIT_REACHED' | 'KEY_UNAVAILABLE'>;

export type SendMessage = (caller: ShipCaller, input: MessageToSend) => Promise<Result<MessageSent, SendMessageRefusal>>;

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
 * With network rules set, a send no rule allows is refused (decision 0034):
 * its unit of work commits only the refusal's record, and the sender gets a
 * refusal without reasons. argo, and an answer to the sender of a message the
 * ship received, always go through.
 *
 * A forced send (decision 0040) needs messages:force, checked before the unit
 * of work starts, so a refusal stores nothing; it rides send reach as any
 * send. Its delivery records that it was forced and comes first.
 *
 * A send to a meeting is a contribution (decision 0061): one message, one
 * delivery per other participant, in the same unit of work, with no reach
 * check: the owner reached each participant when it joined.
 *
 * A send to a label (decision 0065) resolves the selection into its ships,
 * never the sender, each held in id order after the key; the sender must
 * reach every one, or the send is refused whole. One message, one delivery
 * per ship, in the same unit of work.
 *
 * In a sealed fleet (decision 0068, B8) the payload is stored sealed under
 * the fleet's current data key, bound to the new message's id, with its
 * plain byte count. The key is unwrapped before the unit of work, never in
 * it; a key the company's key vault does not give refuses KEY_UNAVAILABLE
 * and nothing is stored.
 */
export function createSendMessage(deps: {
  uow: UnitOfWork<SendMessageTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: RequestHasher;
  sealing: PayloadSealing;
}): SendMessage {
  return async (caller, input) => {
    if (input.contentType !== undefined && isPingContentType(input.contentType)) {
      return refuse('RESERVED_CONTENT_TYPE', `${PING_CONTENT_TYPE} is reserved for pings: ping a ship from the console`);
    }
    if (input.isForced === true && !hasScope(caller, 'messages:force')) {
      return refuse('FORCE_NOT_ALLOWED', 'A forced send needs the messages:force scope');
    }
    const request = checkedSend(input, deps.hasher);
    if (!request.isOk) {
      return request;
    }
    const outcome = await withDataKeys({ sealing: deps.sealing, fleetId: caller.fleetId }, (held) =>
      deps.uow.run(async (tx): Promise<Result<MessageSent | { prevented: NotReachable }, SendMessageRefusal | DataKeysNeeded>> => {
        const sent = await sendWithin({ tx, clock: deps.clock, ids: deps.ids, held }, { caller, request: request.value });
        // A send the network rules refused stored only its refusal's record: committed, then refused.
        return !sent.isOk && sent.error.kind === 'NOT_REACHABLE' ? ok({ prevented: sent.error }) : sent;
      }),
    );
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
  isForced: boolean;
  requestHash: string;
  /** The hash of the request with its payload left out: a sealed message's (decision 0068, B10). */
  sealedRequestHash: string;
  /** For a schedule's send: the schedule and its send time, carried on the envelope (decision 0062). */
  scheduledFor?: ScheduledFor;
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
  if (key.value.startsWith(SCHEDULE_IDEMPOTENCY_KEY_PREFIX)) {
    return refuse('INVALID_IDEMPOTENCY_KEY', `An idempotency key starting ${SCHEDULE_IDEMPOTENCY_KEY_PREFIX} is reserved for scheduled messages: pick another key`);
  }
  const { selector, inReplyTo } = input;
  const isForced = input.isForced === true;
  const request = { selector, contentType: mediaType.value, inReplyTo, isForced };
  const requestHash = hasher.hash(sendRequestText({ ...request, payload: text.value }));
  const sealedRequestHash = hasher.hash(sendRequestText({ ...request, payload: undefined }));
  return ok({ selector, payload: text.value, contentType: mediaType.value, model: input.model, idempotencyKey: key.value, inReplyTo, isForced, requestHash, sealedRequestHash });
}

/** What a send runs with inside its unit of work: the data keys it seals and unseals with among them (decision 0068). */
export interface SendDeps {
  tx: SendMessageTx;
  clock: Clock;
  ids: IdGenerator;
  held: HeldDataKeys;
}

/** Sends a checked request inside the caller's unit of work, as {@link createSendMessage} describes. */
export async function sendWithin(
  deps: SendDeps,
  send: { caller: ShipCaller; request: CheckedSend; actor?: Actor },
): Promise<Result<MessageSent, SendMessageRefusal | DataKeysNeeded>> {
  const { tx, clock, ids } = deps;
  const { fleetId, shipId: senderShipId } = send.caller;
  const { selector, inReplyTo } = send.request;
  const senderKey = { fleetId, senderShipId, idempotencyKey: send.request.idempotencyKey };
  await tx.messages.lockIdempotencyKey(senderKey);
  const original = await tx.messages.findByIdempotencyKey(senderKey);
  if (original) {
    return repeatWithin(deps, { original, request: send.request });
  }

  if (selector.kind === 'meeting') {
    return contributeWithin(deps, { ...send, meeting: selector });
  }
  if (selector.kind === 'label') {
    return sendToLabelWithin(deps, { ...send, label: selector });
  }
  const recipient = await resolveSelector(tx, { fleetId, selector });
  if (!recipient.isOk) {
    return recipient;
  }
  const at = clock.now();
  const repliedTo = inReplyTo === undefined ? undefined : await tx.messages.find(fleetId, inReplyTo);
  const repliedDelivery = repliedTo && (await tx.deliveries.findOfMessageReaching(fleetId, { messageId: repliedTo.id, shipId: senderShipId }));
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
    { recipient: recipient.value, repliedTo, ...reach.value },
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
      requestHash: send.request.requestHash,
      inReplyTo,
      isForced: send.request.isForced,
      ...(send.caller.signedInAccountId === undefined ? {} : { signedInAccountId: send.caller.signedInAccountId }),
      ...(send.actor && { actor: send.actor }),
      ...(send.request.scheduledFor && { scheduledFor: send.request.scheduledFor }),
      at,
    },
  );
  if (!accepted.isOk) {
    return accepted;
  }

  const { delivery, events } = accepted.value;
  const message = await sealedMessage(deps, { message: accepted.value.message, sealedRequestHash: send.request.sealedRequestHash });
  if (!message.isOk) {
    return message;
  }
  await tx.messages.create(message.value);
  await tx.deliveries.create(delivery);
  for (const event of events) {
    await recordEvent({ events: tx.events, ids }, event);
  }
  await tx.notifier.deliveryPending({ fleetId, deliveryId: delivery.id, recipient: delivery.recipient });
  return ok({ messageId: message.value.id });
}

/**
 * A repeat of the sender's key: the original's id when it is the same request,
 * its payload unsealed when sealed, so a sealed original needs its data key.
 */
function repeatWithin(deps: SendDeps, repeat: { original: Message; request: CheckedSend }): Result<MessageSent, SendMessageRefusal | DataKeysNeeded> {
  const { original, request } = repeat;
  const plainPayload = unsealed(deps.held, { row: { fleetId: original.fleetId, rowId: original.id }, payload: original.payload });
  if (!plainPayload.isOk) {
    return plainPayload;
  }
  const same = repeatOf({ message: original, plainPayload: plainPayload.value }, request);
  return same.isOk ? ok({ messageId: same.value }) : same;
}

/**
 * A contribution to a meeting, inside the send's unit of work, its key
 * checked already (decision 0061). The meeting stays held until the unit of
 * work ends, and so does every participant it goes to, as a send holds the
 * ship it addresses; a retired participant is addressed no more and gets
 * none. One message, one delivery per other participant, one MessageAccepted
 * and one notice each.
 */
async function contributeWithin(
  deps: SendDeps,
  send: { caller: ShipCaller; request: CheckedSend; actor?: Actor; meeting: MeetingSelector },
): Promise<Result<MessageSent, SendMessageRefusal | DataKeysNeeded>> {
  const { tx, clock, ids } = deps;
  const { fleetId, shipId: senderShipId } = send.caller;
  const { meetingId } = send.meeting;
  const meeting = await tx.meetings.findForShare(fleetId, meetingId);
  const participants = checkContribution(meeting, { meetingId, senderShipId, inReplyTo: send.request.inReplyTo, isForced: send.request.isForced });
  if (!participants.isOk) {
    return participants;
  }
  const reached: ShipId[] = [];
  for (const shipId of participants.value) {
    const ship = await tx.ships.findForShare(fleetId, shipId);
    if (ship?.retiredAt === null) {
      reached.push(shipId);
    }
  }
  if (reached.length === 0) {
    return refuse('UNRESOLVABLE_SELECTOR', `No other participant of meeting ${meetingId} is active: a retired ship is never addressed again`);
  }
  const at = clock.now();
  const withinLimit = await withinDailyMessageLimit(tx, { fleetId, time: at });
  if (!withinLimit.isOk) {
    return withinLimit;
  }
  const accepted = acceptContribution({
    messageId: ids('message'),
    fleetId,
    senderShipId,
    meetingId,
    deliveries: reached.map((shipId) => ({ deliveryId: ids('delivery'), shipId })),
    payload: send.request.payload,
    contentType: send.request.contentType,
    model: send.request.model,
    senderKind: send.caller.kind,
    idempotencyKey: send.request.idempotencyKey,
    requestHash: send.request.requestHash,
    ...(send.caller.signedInAccountId === undefined ? {} : { signedInAccountId: send.caller.signedInAccountId }),
    at,
  });
  if (!accepted.isOk) {
    return accepted;
  }
  const { deliveries, events } = accepted.value;
  const message = await sealedMessage(deps, { message: accepted.value.message, sealedRequestHash: send.request.sealedRequestHash });
  if (!message.isOk) {
    return message;
  }
  await tx.messages.create(message.value);
  for (const delivery of deliveries) {
    await tx.deliveries.create(delivery);
  }
  for (const event of events) {
    await recordEvent({ events: tx.events, ids }, event);
  }
  for (const delivery of deliveries) {
    await tx.notifier.deliveryPending({ fleetId, deliveryId: delivery.id, recipient: delivery.recipient });
  }
  return ok({ messageId: message.value.id });
}

/**
 * A send to a label selection, inside the send's unit of work, its key
 * checked already (decision 0065). Every ship of the list stays held until
 * the unit of work ends; the reach to each is checked as a send to it, and
 * the first refused refuses the whole send with only its record stored. One
 * message, one delivery per ship, one MessageAccepted and one notice each.
 */
async function sendToLabelWithin(
  deps: SendDeps,
  send: { caller: ShipCaller; request: CheckedSend; actor?: Actor; label: LabelSelector },
): Promise<Result<MessageSent, SendMessageRefusal | DataKeysNeeded>> {
  const { tx, clock, ids } = deps;
  const { fleetId, shipId: senderShipId } = send.caller;
  const { inReplyTo } = send.request;
  const ships = await resolveLabelSelection(tx, { fleetId, valueIds: send.label.valueIds, senderShipId });
  if (!ships.isOk) {
    return ships;
  }
  const at = clock.now();
  const repliedTo = inReplyTo === undefined ? undefined : await tx.messages.find(fleetId, inReplyTo);
  const repliedDelivery = repliedTo && (await tx.deliveries.findOfMessageReaching(fleetId, { messageId: repliedTo.id, shipId: senderShipId }));
  const reach = await checkReachToEach(
    { tx, ids },
    { fleetId, senderShipId, recipients: ships.value.map((shipId) => ({ kind: 'ship', shipId })), asked: repliedTo && repliedDelivery && { message: repliedTo, delivery: repliedDelivery }, at },
  );
  if (!reach.isOk) {
    return reach;
  }
  const withinLimit = await withinDailyMessageLimit(tx, { fleetId, time: at });
  if (!withinLimit.isOk) {
    return withinLimit;
  }
  const accepted = acceptLabelMessage(repliedTo, {
    messageId: ids('message'),
    fleetId,
    senderShipId,
    valueIds: send.label.valueIds,
    deliveries: ships.value.map((shipId) => ({ deliveryId: ids('delivery'), shipId })),
    payload: send.request.payload,
    contentType: send.request.contentType,
    model: send.request.model,
    senderKind: send.caller.kind,
    idempotencyKey: send.request.idempotencyKey,
    requestHash: send.request.requestHash,
    inReplyTo,
    isForced: send.request.isForced,
    ...(send.caller.signedInAccountId === undefined ? {} : { signedInAccountId: send.caller.signedInAccountId }),
    ...(send.actor && { actor: send.actor }),
    ...(send.request.scheduledFor && { scheduledFor: send.request.scheduledFor }),
    at,
  });
  if (!accepted.isOk) {
    return accepted;
  }
  const { deliveries, events } = accepted.value;
  const message = await sealedMessage(deps, { message: accepted.value.message, sealedRequestHash: send.request.sealedRequestHash });
  if (!message.isOk) {
    return message;
  }
  await tx.messages.create(message.value);
  for (const delivery of deliveries) {
    await tx.deliveries.create(delivery);
  }
  for (const event of events) {
    await recordEvent({ events: tx.events, ids }, event);
  }
  for (const delivery of deliveries) {
    await tx.notifier.deliveryPending({ fleetId, deliveryId: delivery.id, recipient: delivery.recipient });
  }
  return ok({ messageId: message.value.id });
}
