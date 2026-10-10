import type { CONSOLE_READS } from './console-reads';
import { dataOf, type PluginAnswer } from './plugin-answer';

/**
 * A console read as the browser asks it (lib/console-reads.ts): a GET to the
 * web app's /api/reads/<name>, beside any server function still running.
 */

type Reads = typeof CONSOLE_READS;
type ReadName = keyof Reads;
type InputOf<K extends ReadName> = Parameters<Reads[K]['read']>[0];
type DataOf<K extends ReadName> = Extract<Awaited<ReturnType<Reads[K]['read']>>, { kind: 'answered' }>['data'];

export type ConsoleReadRequest<K extends ReadName> = { read: K } & (undefined extends InputOf<K> ? { input?: InputOf<K> } : { input: InputOf<K> });

const NO_ANSWER = 'The console did not answer: try again in a moment';
const UNAUTHORIZED = 401;

/** A read refused because the console session ended, coded as tRPC codes it, so the page sends the operator to sign in as for any call (lib/session.ts) and does not retry. */
class SessionEndedError extends Error {
  readonly data: { code: 'UNAUTHORIZED'; refusal?: 'SIGNED_IN_ELSEWHERE' };

  constructor(message: string, isSignedInElsewhere: boolean) {
    super(message);
    this.data = isSignedInElsewhere ? { code: 'UNAUTHORIZED', refusal: 'SIGNED_IN_ELSEWHERE' } : { code: 'UNAUTHORIZED' };
  }
}

/**
 * The one point where the browser trusts the web app's server: the route
 * parsed the plugin's answer and typed it, so the browser checks only that
 * an answer came, never its data (decision 0033).
 */
function isAnswer<T>(value: unknown): value is PluginAnswer<T> {
  return typeof value === 'object' && value !== null && 'kind' in value && (value.kind === 'answered' || value.kind === 'refused');
}

/** The read's data, or its refusal thrown as an Error with its words, as TanStack Query expects. */
export async function fetchConsoleRead<K extends ReadName>(request: ConsoleReadRequest<K>, send: typeof fetch = fetch): Promise<DataOf<K>> {
  const search = request.input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(request.input))}`;
  let answer: unknown;
  let status: number;
  try {
    const response = await send(`/api/reads/${request.read}${search}`, { cache: 'no-store' });
    status = response.status;
    answer = await response.json();
  } catch {
    throw new Error(NO_ANSWER);
  }
  if (!isAnswer<DataOf<K>>(answer)) {
    throw new Error(NO_ANSWER);
  }
  if (status === UNAUTHORIZED && answer.kind === 'refused') {
    throw new SessionEndedError(answer.message, 'refusal' in answer && answer.refusal === 'SIGNED_IN_ELSEWHERE');
  }
  return dataOf(answer);
}
