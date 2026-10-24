import { type DeliveryId, fleetListOutputSchema, inboxMessageSchema, inboxQuestionOf, type InboxFilter, type InboxMessage, isInReadReach, type MessageId, messageOutputSchema, operatorInboxOutputSchema, PAGE_SIZE_MAX } from '@aeolus-fleet/common';
import { cookies } from 'next/headers';
import type { z } from 'zod';

import { everyPage } from './every-page';
import { inboxEntriesOf, inboxEntryOf } from './inbox-entries';
import { readInboxPagesUntil, type InboxPage } from './inbox-pages';
import type { InboxEntry } from './inbox-entry';
import { threadBefore, type ThreadMessage } from './inbox-thread';
import type { PluginAnswer } from './plugin-answer';
import { callPlugin, sessionCookieOf } from './plugin-call';
import { serverInternalUrlFrom } from './server-url';
import { EVERY_SHIP_STATUS } from './every-ship-status';

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

/** The fleet's ships argo reads whole: every one (decision 0034), page after page. */
async function readShips() {
  const ships = await everyPage((cursor) => callFleet('fleet.list', { input: { cursor, limit: PAGE_SIZE_MAX, status: EVERY_SHIP_STATUS }, answers: fleetListOutputSchema }));
  return ships.kind === 'answered' ? { ...ships, data: ships.data.filter(isInReadReach) } : ships;
}

/**
 * The newest questions and messages to argo the segment keeps, as core reads
 * it by delivery state, as many as the operator asked to see, laid out for
 * reading, and whether older ones follow. A question shows stale only when
 * what withdrew it is among the rows read.
 */
export async function readInbox({ filter, size }: { filter: InboxFilter; size: number }): Promise<PluginAnswer<{ items: InboxEntry[]; hasMore: boolean }>> {
  const [inbox, ships] = await Promise.all([readArgoInbox({ filter, limit: Math.min(size, PAGE_SIZE_MAX), isEnough: (messages) => messages.length >= size }), readShips()]);
  if (inbox.kind !== 'answered') {
    return inbox;
  }
  const { items, nextCursor } = inbox.data;
  // Without the fleet's ships every message still shows, only none folds as a plugin ship's.
  return { kind: 'answered', data: { items: inboxEntriesOf(items.slice(0, size), ships.kind === 'answered' ? ships.data : []), hasMore: nextCursor !== null || items.length > size } };
}

/**
 * The question or message to argo with this delivery, whatever segment keeps
 * it: the one the reader shows, which an answer or Mark done takes out of Open.
 */
export async function readInboxEntry(deliveryId: DeliveryId): Promise<PluginAnswer<InboxEntry | null>> {
  const [inbox, ships] = await Promise.all([readQuestionInbox(deliveryId), readShips()]);
  if (inbox.kind !== 'answered') {
    return inbox;
  }
  return { kind: 'answered', data: inboxEntryOf(inbox.data, { ships: ships.kind === 'answered' ? ships.data : [], deliveryId }) };
}

/** The messages a message to argo replies to, oldest first. */
export async function readThread(from: MessageId): Promise<PluginAnswer<ThreadMessage[]>> {
  const ships = await readShips();
  if (ships.kind !== 'answered') {
    return ships;
  }
  const argo = ships.data.find(({ kind }) => kind === 'operator');
  if (argo === undefined) {
    return { kind: 'refused', message: 'The fleet lists no argo' };
  }
  const read = async (messageId: MessageId) => {
    const message = await callFleet('fleet.message', { input: { messageId }, answers: messageOutputSchema });
    return message.kind === 'answered' ? message.data : undefined;
  };
  return { kind: 'answered', data: await threadBefore(from, { read, argoId: argo.id }) };
}
