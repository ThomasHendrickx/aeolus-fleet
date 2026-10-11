import { operatorInboxOutputSchema, type InboxMessage } from '@aeolus-fleet/common';
import { cookies } from 'next/headers';
import type { z } from 'zod';

import type { PluginAnswer } from './plugin-answer';
import { callPlugin, sessionCookieOf } from './plugin-call';
import { questionsIn } from './question-answer';
import type { QuestionMessage } from './questions';
import { serverInternalUrlFrom } from './server-url';

/**
 * The fleet as the questions page reaches it from the web app's server
 * (decision 0033): argo's inbox, read with the operator's console session,
 * parsed for questions here (lib/question-answer.ts).
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

/** The questions to argo, newest first, each with its answer or none. */
export async function readQuestions(): Promise<PluginAnswer<QuestionMessage[]>> {
  const inbox = await readArgoInbox();
  return inbox.kind === 'answered' ? { kind: 'answered', data: questionsIn(inbox.data) } : inbox;
}
