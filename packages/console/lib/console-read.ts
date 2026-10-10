import type { z } from 'zod';

import type { SessionState } from './console-gate';
import type { PluginAnswer } from './plugin-answer';

/**
 * A console read: what a page asks of the web app's server, answered by the
 * route handler at /api/reads/<name> (decision 0033). Reads go through a
 * route handler, not a server function, because Next.js runs a browser's
 * server functions one at a time: a read through one would wait behind a
 * mutation still running.
 */
export interface ConsoleRead<I, T> {
  /** The input the read takes, parsed here from the request's `input`: outside data. */
  input: z.ZodType<I>;
  // A method, so a read of any input fits ConsoleReads; the handler only ever pairs a read with its own input.
  read(input: I): Promise<PluginAnswer<T>>;
}

export function consoleRead<I, T>(input: z.ZodType<I>, read: (input: I) => Promise<PluginAnswer<T>>): ConsoleRead<I, T> {
  return { input, read };
}

export type ConsoleReads = Readonly<Record<string, ConsoleRead<unknown, unknown>>>;

const NO_SUCH_READ: PluginAnswer<never> = { kind: 'refused', message: 'The console has no such read' };
const SESSION_ENDED: PluginAnswer<never> = { kind: 'refused', message: 'Your console session ended: sign in again' };
/** The server's own words and refusal, so the page says why it went to sign in, as it does for a tRPC call (lib/session.ts). */
const SIGNED_IN_ELSEWHERE = { kind: 'refused', message: 'You signed in somewhere else, which ended this console session', refusal: 'SIGNED_IN_ELSEWHERE' } as const;
const UNREADABLE: PluginAnswer<never> = { kind: 'refused', message: 'The console cannot read that' };
const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const BAD_REQUEST = 400;

/** The request's `input`, JSON in the query string; undefined without one, or when it is not JSON. */
function inputOf(request: Request): { isReadable: boolean; value: unknown } {
  const input = new URL(request.url).searchParams.get('input');
  if (input === null) {
    return { isReadable: true, value: undefined };
  }
  try {
    return { isReadable: true, value: JSON.parse(input) };
  } catch {
    return { isReadable: false, value: undefined };
  }
}

/**
 * Answers the named read, for its input: the read's answer, a refusal
 * included, as JSON. Only a live session is read for: every name answers an
 * ended session with the same 401, so the page goes to sign in (saying so
 * when the operator signed in somewhere else), and answers
 * as one it does not have while the session check does not answer; either
 * way nothing tells which reads or plugins this console has.
 */
export async function answerConsoleRead(request: Request, { name, reads, sessionOf }: { name: string; reads: ConsoleReads; sessionOf: (request: Request) => Promise<SessionState> }): Promise<Response> {
  const session = await sessionOf(request);
  if (session === 'ended') {
    return Response.json(SESSION_ENDED, { status: UNAUTHORIZED });
  }
  if (session === 'signedInElsewhere') {
    return Response.json(SIGNED_IN_ELSEWHERE, { status: UNAUTHORIZED });
  }
  if (session === 'unknown') {
    return Response.json(NO_SUCH_READ, { status: NOT_FOUND });
  }
  // Only the reads' own names: an inherited one, such as toString, is no read.
  const named = Object.hasOwn(reads, name) ? reads[name] : undefined;
  if (named === undefined) {
    return Response.json(NO_SUCH_READ, { status: NOT_FOUND });
  }
  const raw = inputOf(request);
  const parsed = named.input.safeParse(raw.value);
  if (!raw.isReadable || !parsed.success) {
    return Response.json(UNREADABLE, { status: BAD_REQUEST });
  }
  return Response.json(await named.read(parsed.data));
}
