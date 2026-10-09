import { z } from 'zod';

import type { PluginAnswer } from './plugin-answer';

/**
 * A plugin's tRPC procedure called from the web app's server (decision 0033),
 * with only the operator's console session cookie, which the plugin checks
 * with the fleet. Its answer is outside data, parsed here, so the browser gets
 * typed data and no plugin code or schema.
 */

/** The console session cookie the fleet sets: the only cookie a plugin needs. */
const SESSION_COOKIE_NAME = 'aeolus_session';

const TIMEOUT_MS = 30_000;

const answerSchema = z.union([z.object({ result: z.object({ data: z.unknown() }) }), z.object({ error: z.object({ message: z.string() }) })]);

/** The request's cookie header down to the console session cookie, or empty without one. */
export function sessionCookieOf(cookieHeader: string | null): string {
  const session = (cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  return session ?? '';
}

export interface PluginCall<T> {
  /** The plugin's name, as a refusal names it. */
  plugin: string;
  url: string;
  procedure: string;
  input?: unknown;
  isMutation?: boolean;
  cookie: string;
  answers: z.ZodType<T>;
  fetch?: typeof fetch;
}

/** Calls the procedure and parses its answer: the data, the plugin's refusal, or why there is none. */
export async function callPlugin<T>(call: PluginCall<T>): Promise<PluginAnswer<T>> {
  const send = call.fetch ?? fetch;
  const headers: Record<string, string> = { cookie: call.cookie };
  let response: Response;
  try {
    if (call.isMutation === true) {
      headers['content-type'] = 'application/json';
      response = await send(`${call.url}/trpc/${call.procedure}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(call.input ?? {}),
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } else {
      const search = call.input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(call.input))}`;
      response = await send(`${call.url}/trpc/${call.procedure}${search}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    }
  } catch {
    return { kind: 'refused', message: `${call.plugin} did not answer: try again in a moment` };
  }
  const answer = answerSchema.safeParse(await response.json().catch(() => undefined));
  if (!answer.success) {
    return { kind: 'refused', message: `${call.plugin} answered something the console does not understand` };
  }
  if ('error' in answer.data) {
    return { kind: 'refused', message: answer.data.error.message };
  }
  const data = call.answers.safeParse(answer.data.result.data);
  return data.success ? { kind: 'answered', data: data.data } : { kind: 'refused', message: `${call.plugin} answered something the console does not understand` };
}
