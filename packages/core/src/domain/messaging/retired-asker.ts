import { inboxQuestionOf, WITHDRAWAL_CONTENT_TYPE, type FleetId, type IdGenerator, type MessageId, type ShipId } from '@aeolus-fleet/common';

import { recordEvent, type Actor } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import { listedUnsealed, sealedMessage, type DataKeysNeeded, type HeldDataKeys } from './data-keys.js';
import type { MeetingNoticeTx } from './meeting-notice.js';
import { acceptMessage, type AcceptRefusal, type Message } from './message.js';
import type { MessageRepository, RequestHasher, SentQuestionMessage } from './ports.js';
import { sendRequestText } from './send-request.js';

export interface RetiredAskerTx extends Omit<MeetingNoticeTx, 'messages'> {
  messages: Pick<MessageRepository, 'create' | 'listQuestionMessagesOf'>;
}

/** An open question: the ship it was asked of and its uuid. */
interface OpenQuestion {
  askedShipId: ShipId;
  questionId: string;
}

/** A message as this reads it: its payload plain, or null when it does not open (B9). */
interface ReadMessage {
  id: MessageId;
  contentType: string;
  payload: string | null;
  sentAt: Date;
}

/**
 * Within the retire's unit of work, withdraws every question the retiring
 * ship asked that is still open (#1632, decision 0038): one withdrawal from
 * it to the ship it asked, naming the question's uuid, as its own `withdraw`
 * sends it, with its pending delivery, MessageAccepted caused by the retire's
 * actor, and the notice that wakes the asked ship. The asked ship then shows
 * the question as a withdrawn one goes, and no answer is written to a ship
 * that is never addressed again. No model: the retire is no session's
 * message. Open means not answered by the asked ship and not withdrawn or
 * replaced by the asker already; an open replacement goes by its own uuid.
 * A payload that does not open for its row (B9) names no question and is
 * passed over; one sealed under a key not held asks for it.
 */
export async function withdrawQuestionsOnRetire(
  deps: { tx: RetiredAskerTx; ids: IdGenerator; hasher: RequestHasher; held: HeldDataKeys },
  retire: { fleetId: FleetId; shipId: ShipId; actor: Actor; at: Date },
): Promise<Result<undefined, AcceptRefusal | DataKeysNeeded>> {
  const sent = readSent(deps.held, await deps.tx.messages.listQuestionMessagesOf(retire.fleetId, retire.shipId));
  if (!sent.isOk) {
    return sent;
  }
  for (const open of openQuestionsOf(sent.value)) {
    const withdrawn = await sendWithdrawal(deps, { ...retire, ...open });
    if (!withdrawn.isOk) {
      return withdrawn;
    }
  }
  return ok(undefined);
}

/** The sent messages and their replies, read plain. */
function readSent(
  held: HeldDataKeys,
  sent: readonly SentQuestionMessage[],
): Result<{ message: Message; read: ReadMessage; replies: ReadMessage[] }[], DataKeysNeeded> {
  const read: { message: Message; read: ReadMessage; replies: ReadMessage[] }[] = [];
  for (const { message, replies } of sent) {
    const plain = readOf(held, message);
    if (!plain.isOk) {
      return plain;
    }
    const readReplies: ReadMessage[] = [];
    for (const reply of replies) {
      const plainReply = readOf(held, reply);
      if (!plainReply.isOk) {
        return plainReply;
      }
      readReplies.push(plainReply.value);
    }
    read.push({ message, read: plain.value, replies: readReplies });
  }
  return ok(read);
}

function readOf(held: HeldDataKeys, message: Message): Result<ReadMessage, DataKeysNeeded> {
  const payload = listedUnsealed(held, { row: { fleetId: message.fleetId, rowId: message.id }, payload: message.payload });
  if (!payload.isOk) {
    return payload;
  }
  return ok({ id: message.id, contentType: message.contentType, payload: typeof payload.value === 'string' ? payload.value : null, sentAt: message.createdAt });
}

/** The questions still open among what the ship sent, each once, in the order asked. */
function openQuestionsOf(sent: readonly { message: Message; read: ReadMessage; replies: readonly ReadMessage[] }[]): OpenQuestion[] {
  const keyOf = ({ askedShipId, questionId }: OpenQuestion) => `${askedShipId} ${questionId}`;
  const settled = new Set<string>();
  for (const { message } of sent) {
    if (message.selector.kind === 'ship' && message.questionId !== null) {
      // A withdrawal or a replacement from the asker settles the question it names.
      settled.add(keyOf({ askedShipId: message.selector.shipId, questionId: message.questionId }));
    }
  }
  const open: OpenQuestion[] = [];
  for (const { message, read, replies } of sent) {
    if (message.selector.kind !== 'ship' || read.payload === null) {
      continue;
    }
    const readable = replies.flatMap((reply) => (reply.payload === null ? [] : [{ id: reply.id, contentType: reply.contentType, payload: reply.payload, sentAt: reply.sentAt }]));
    const question = inboxQuestionOf({ message: { contentType: read.contentType, payload: read.payload }, replies: readable });
    const asked = question === null ? undefined : { askedShipId: message.selector.shipId, questionId: question.id };
    if (asked !== undefined && question?.answer === null && !settled.has(keyOf(asked))) {
      settled.add(keyOf(asked));
      open.push(asked);
    }
  }
  return open;
}

/** The withdrawal of one question, stored as a send stores it: sealed in a sealed fleet (decision 0068). */
async function sendWithdrawal(
  deps: { tx: RetiredAskerTx; ids: IdGenerator; hasher: RequestHasher; held: HeldDataKeys },
  withdrawal: OpenQuestion & { fleetId: FleetId; shipId: ShipId; actor: Actor; at: Date },
): Promise<Result<undefined, AcceptRefusal | DataKeysNeeded>> {
  const { tx, ids, hasher } = deps;
  const { fleetId, at } = withdrawal;
  const recipient = { kind: 'ship' as const, shipId: withdrawal.askedShipId };
  const payload = JSON.stringify({ questionId: withdrawal.questionId });
  const contentType = WITHDRAWAL_CONTENT_TYPE;
  const messageId = ids('message');
  const accepted = acceptMessage(
    { recipient, repliedTo: undefined },
    {
      messageId,
      deliveryId: ids('delivery'),
      fleetId,
      senderShipId: withdrawal.shipId,
      payload,
      contentType,
      model: undefined,
      // The fleet's own key for the withdrawal, as a meeting notice's is: one per message.
      idempotencyKey: `retire-withdrawal-${messageId}`,
      requestHash: hasher.hash(sendRequestText({ selector: recipient, payload, contentType, inReplyTo: undefined, isForced: false })),
      inReplyTo: undefined,
      isForced: false,
      actor: withdrawal.actor,
      at,
    },
  );
  if (!accepted.isOk) {
    return accepted;
  }
  const message = await sealedMessage(deps, {
    message: accepted.value.message,
    sealedRequestHash: hasher.hash(sendRequestText({ selector: recipient, payload: undefined, contentType, inReplyTo: undefined, isForced: false })),
  });
  if (!message.isOk) {
    return message;
  }
  const { delivery, events } = accepted.value;
  await tx.messages.create(message.value);
  await tx.deliveries.create(delivery, message.value);
  for (const event of events) {
    await recordEvent({ events: tx.events, ids }, event);
  }
  await tx.notifier.deliveryPending({ fleetId, deliveryId: delivery.id, recipient: delivery.recipient });
  return ok(undefined);
}
