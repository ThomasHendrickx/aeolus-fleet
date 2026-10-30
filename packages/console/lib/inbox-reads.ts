import { type DeliveryId, fleetListOutputSchema, inboxMessageSchema, inboxQuestionOf, type InboxFilter, type InboxMessage, type MessageId, messageOutputSchema, operatorInboxOutputSchema, PAGE_SIZE_MAX } from '@aeolus-fleet/common';
import { cookies } from 'next/headers';
import type { z } from 'zod';

import { inboxEntriesOf, inboxEntryOf } from './inbox-entries';
import { readInboxSenders, type ListShips } from './inbox-senders';
import { readInboxPagesUntil, type InboxPage } from './inbox-pages';
import type { InboxEntry } from './inbox-entry';
import { threadBefore, type ThreadMessage } from './inbox-thread';
import type { PluginAnswer } from './plugin-answer';
import { callPlugin, sessionCookieOf } from './plugin-call';
import { serverInternalUrlFrom } from './server-url';

/**
 * argo's inbox as the inbox page reaches it from the web app's server
 * (decisions 0033, 0038, #849): the inbox, read with the operator's console
 * session, laid out here (lib/inbox-entries.ts), and a message's thread.
 */

const FLEET = 'The fleet';

/** Calls one of the fleet's tRPC procedures with the operator's console session, and the console's Origin for a change. */
export async function callFleet<T>(procedure: string, request: { input?: unknown; isMutation?: boolean; origin?: string; answers: z.ZodType<T> }): Promise<PluginAnswer<T>> {
  const cookie = sessionCookieOf((await cookies()).toString());
  return callPlugin({ plugin: FLEET, url: serverInternalUrlFrom(process.env), procedure, cookie, ...request });
}

/** Pages of argo's inbox the filter keeps, newest first from the cursor, read until the rows are enough or the inbox ends. */
function readArgoInbox(query: { filter: InboxFilter; cursor?: DeliveryId; limit: number; isEnough: (messages: readonly InboxMessage[]) => boolean }): Promise<PluginAnswer<InboxPage>> {
  const { filter, limit } = query;
  return readInboxPagesUntil((cursor) => callFleet('fleet.inbox', { input: { filter, cursor, limit }, answers: operatorInboxOutputSchema }), query);
}

/**
 * The message to argo with this delivery, and when it asks a question, the
 * messages that withdraw or replace that question (decision 0038): each read
 * by one lookup in core, however old. Its asker's first withdrawal makes a
 * question stale, so the first page, oldest first, is enough.
 */
export async function readQuestionInbox(deliveryId: DeliveryId): Promise<PluginAnswer<InboxMessage[]>> {
  const found = await callFleet('fleet.inboxMessage', { input: { deliveryId }, answers: inboxMessageSchema });
  if (found.kind !== 'answered') {
    return found;
  }
  const question = inboxQuestionOf({ message: found.data.message, replies: [] });
  if (question === null) {
    return { kind: 'answered', data: [found.data] };
  }
  const withdrawals = await callFleet('fleet.inboxWithdrawals', { input: { questionId: question.id }, answers: operatorInboxOutputSchema });
  return withdrawals.kind === 'answered' ? { kind: 'answered', data: [found.data, ...withdrawals.data.items] } : withdrawals;
}

const listShips: ListShips = (input) => callFleet('fleet.list', { input, answers: fleetListOutputSchema });

/** The ships the messages read name, or none when the fleet does not answer: every message still shows, only none folds as a plugin ship's. */
async function sendersOf(inbox: readonly InboxMessage[]) {
  const senders = await readInboxSenders(inbox, listShips);
  return senders.kind === 'answered' ? senders.data : [];
}

/**
 * The newest questions and messages to argo the segment keeps, as core reads
 * it by delivery state, as many as the operator asked to see, laid out for
 * reading, and whether older ones follow. A question shows stale only when
 * what withdrew it is among the rows read.
 */
export async function readInbox({ filter, size }: { filter: InboxFilter; size: number }): Promise<PluginAnswer<{ items: InboxEntry[]; hasMore: boolean }>> {
  const inbox = await readArgoInbox({ filter, limit: Math.min(size, PAGE_SIZE_MAX), isEnough: (messages) => messages.length >= size });
  if (inbox.kind !== 'answered') {
    return inbox;
  }
  const { items, nextCursor } = inbox.data;
  const shown = items.slice(0, size);
  return { kind: 'answered', data: { items: inboxEntriesOf(shown, await sendersOf(shown)), hasMore: nextCursor !== null || items.length > size } };
}

/**
 * The question or message to argo with this delivery, whatever segment keeps
 * it: the one the reader shows, which an answer or Mark done takes out of Open.
 */
export async function readInboxEntry(deliveryId: DeliveryId): Promise<PluginAnswer<InboxEntry | null>> {
  const inbox = await readQuestionInbox(deliveryId);
  if (inbox.kind !== 'answered') {
    return inbox;
  }
  return { kind: 'answered', data: inboxEntryOf(inbox.data, { ships: await sendersOf(inbox.data), deliveryId }) };
}

/** The messages a message to argo replies to, oldest first. */
export async function readThread(from: MessageId): Promise<PluginAnswer<ThreadMessage[]>> {
  const operator = await callFleet('fleet.list', { input: { shipKind: ['operator'], limit: 1 }, answers: fleetListOutputSchema });
  if (operator.kind !== 'answered') {
    return operator;
  }
  const [argo] = operator.data.items;
  if (argo === undefined) {
    return { kind: 'refused', message: 'The fleet lists no argo' };
  }
  const read = async (messageId: MessageId) => {
    const message = await callFleet('fleet.message', { input: { messageId }, answers: messageOutputSchema });
    // A sealed payload whose company key is not reachable ends the thread, as a message it cannot read does (decision 0068).
    return message.kind === 'answered' && !message.data.isPayloadUnreadable ? message.data : undefined;
  };
  return { kind: 'answered', data: await threadBefore(from, { read, argoId: argo.id }) };
}
