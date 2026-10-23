import { type DeliveryId, fleetListOutputSchema, type InboxFilter, type InboxMessage, isInReadReach, type MessageId, messageOutputSchema, operatorInboxOutputSchema, PAGE_SIZE_MAX } from '@aeolus-fleet/common';
import { cookies } from 'next/headers';
import type { z } from 'zod';

import { inboxEntriesOf, inboxEntryOf, openEntriesOf } from './inbox-entries';
import { questionsIn } from './question-answer';
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

/** argo's messages newest first until the one with this delivery: a question with every withdrawal of it, which is newer. */
export function readArgoInboxTo(deliveryId: DeliveryId): Promise<PluginAnswer<InboxPage>> {
  return readArgoInbox({ filter: 'all', limit: PAGE_SIZE_MAX, isEnough: (messages) => messages.some((message) => message.deliveryId === deliveryId) });
}

/** The fleet's ships argo reads whole: every one (decision 0034). */
async function readShips() {
  const ships = await callFleet('fleet.list', { answers: fleetListOutputSchema });
  return ships.kind === 'answered' ? { ...ships, data: ships.data.filter(isInReadReach) } : ships;
}

/**
 * The newest questions and messages to argo the segment keeps, as many as the
 * operator asked to see, laid out for reading, and whether older ones follow.
 * A question's withdrawals are newer than the question, so the rows shown
 * hold every withdrawal of each question among them.
 */
export async function readInbox({ filter, size }: { filter: InboxFilter; size: number }): Promise<PluginAnswer<{ items: InboxEntry[]; hasMore: boolean }>> {
  // Done reads every message: a stale question is done though its delivery is still open (decision 0038); the page keeps what its segment shows.
  const read = filter === 'done' ? 'all' : filter;
  const [inbox, ships] = await Promise.all([readArgoInbox({ filter: read, limit: Math.min(size, PAGE_SIZE_MAX), isEnough: (messages) => messages.length >= size }), readShips()]);
  if (inbox.kind !== 'answered') {
    return inbox;
  }
  const { items, nextCursor } = inbox.data;
  const shown = items.slice(0, size);
  // Without the fleet's ships every message still shows, only none folds as a plugin ship's.
  const listed = ships.kind === 'answered' ? ships.data : [];
  const hasMore = nextCursor !== null || items.length > size;
  if (filter !== 'open') {
    return { kind: 'answered', data: { items: inboxEntriesOf(shown, listed), hasMore } };
  }
  // What makes an open question stale is newer and need not be open: read every message to the oldest question shown.
  const oldest = questionsIn(shown).at(-1);
  const newer = oldest === undefined ? undefined : await readArgoInboxTo(oldest.deliveryId);
  if (newer?.kind === 'refused') {
    return newer;
  }
  return { kind: 'answered', data: { items: openEntriesOf(shown, { newer: newer?.data.items ?? [], ships: listed }), hasMore } };
}

/**
 * The question or message to argo with this delivery, whatever segment keeps
 * it: the one the reader shows, which an answer or Mark done takes out of Open.
 */
export async function readInboxEntry(deliveryId: DeliveryId): Promise<PluginAnswer<InboxEntry | null>> {
  const [inbox, ships] = await Promise.all([readArgoInboxTo(deliveryId), readShips()]);
  if (inbox.kind !== 'answered') {
    return inbox;
  }
  return { kind: 'answered', data: inboxEntryOf(inbox.data.items, { ships: ships.kind === 'answered' ? ships.data : [], deliveryId }) };
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
