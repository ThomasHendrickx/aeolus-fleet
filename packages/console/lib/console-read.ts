import type { z } from 'zod';

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
const UNREADABLE: PluginAnswer<never> = { kind: 'refused', message: 'The console cannot read that' };
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

/** Answers the named read, for its input: the read's answer, a refusal included, as JSON. */
export async function answerConsoleRead(request: Request, { name, reads }: { name: string; reads: ConsoleReads }): Promise<Response> {
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
