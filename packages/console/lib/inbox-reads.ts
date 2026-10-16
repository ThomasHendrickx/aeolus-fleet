import { fleetListOutputSchema, messageOutputSchema, operatorInboxOutputSchema, type InboxMessage, type MessageId } from '@aeolus-fleet/common';
import { cookies } from 'next/headers';
import type { z } from 'zod';

import { inboxEntriesOf } from './inbox-entries';
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

/** argo's whole inbox, every message with argo's replies to it. */
export function readArgoInbox(): Promise<PluginAnswer<InboxMessage[]>> {
  return callFleet('fleet.inbox', { input: { filter: 'all' }, answers: operatorInboxOutputSchema });
}

function readShips() {
  return callFleet('fleet.list', { answers: fleetListOutputSchema });
}

/** Every question and message to argo, laid out for reading. */
export async function readInbox(): Promise<PluginAnswer<InboxEntry[]>> {
  const [inbox, ships] = await Promise.all([readArgoInbox(), readShips()]);
  if (inbox.kind !== 'answered') {
    return inbox;
  }
  // Without the fleet's ships every message still shows, only none folds as a plugin ship's.
  return { kind: 'answered', data: inboxEntriesOf(inbox.data, ships.kind === 'answered' ? ships.data : []) };
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
