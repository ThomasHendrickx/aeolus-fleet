import { type DeliveryId, fleetListOutputSchema, type InboxFilter, type InboxMessage, isInReadReach, type MessageId, messageOutputSchema, operatorInboxOutputSchema, PAGE_SIZE_MAX } from '@aeolus-fleet/common';
import { cookies } from 'next/headers';
import type { z } from 'zod';

import { inboxEntriesOf } from './inbox-entries';
import { mergedInbox, pageEntriesOf, readInboxPagesUntil, type InboxPage } from './inbox-pages';
import { CONSOLE_PAGE_SIZE } from './paged-list';
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

/** argo's open messages whole: what waits on the operator, which the navigation counts. */
function readOpenInbox(): Promise<PluginAnswer<InboxPage>> {
  return readArgoInbox({ filter: 'open', limit: PAGE_SIZE_MAX, isEnough: () => false });
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
 * The questions and messages to argo, laid out for reading: every open one,
 * and every one sent since the given time (the start of the operator's day,
 * for what was done today), with where the older ones start.
 */
export async function readInbox({ since }: { since: string }): Promise<PluginAnswer<{ entries: InboxEntry[]; olderCursor: DeliveryId | null }>> {
  const [open, recent, ships] = await Promise.all([
    readOpenInbox(),
    readArgoInbox({ filter: 'all', limit: CONSOLE_PAGE_SIZE, isEnough: (messages) => (messages.at(-1)?.message.sentAt ?? since) < since }),
    readShips(),
  ]);
  if (open.kind !== 'answered') {
    return open;
  }
  if (recent.kind !== 'answered') {
    return recent;
  }
  // Without the fleet's ships every message still shows, only none folds as a plugin ship's.
  return { kind: 'answered', data: { entries: inboxEntriesOf(mergedInbox(open.data.items, recent.data.items), ships.kind === 'answered' ? ships.data : []), olderCursor: recent.data.nextCursor } };
}

/** A page of the older questions and messages to argo, after the cursor, laid out beside the open ones. */
export async function readOlderInbox({ cursor }: { cursor: DeliveryId }): Promise<PluginAnswer<{ items: InboxEntry[]; nextCursor: DeliveryId | null }>> {
  const [open, page, ships] = await Promise.all([readOpenInbox(), readArgoInbox({ filter: 'all', cursor, limit: CONSOLE_PAGE_SIZE, isEnough: () => true }), readShips()]);
  if (open.kind !== 'answered') {
    return open;
  }
  if (page.kind !== 'answered') {
    return page;
  }
  const items = pageEntriesOf({ page: page.data.items, open: open.data.items, ships: ships.kind === 'answered' ? ships.data : [] });
  return { kind: 'answered', data: { items, nextCursor: page.data.nextCursor } };
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
