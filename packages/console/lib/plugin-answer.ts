/**
 * What a console read (lib/console-reads.ts) or a plugin's server function
 * (lib/squadrons-actions.ts, lib/trierarch-plugin-actions.ts) hands the
 * browser: the parsed data, or the words to show. A refusal travels as data
 * because a server function's thrown error reaches the browser without its
 * message in production.
 */
export type PluginAnswer<T> = { kind: 'answered'; data: T } | { kind: 'refused'; message: string };

/** The data, or the refusal thrown as an Error with its words, as TanStack Query expects. */
export function dataOf<T>(answer: PluginAnswer<T>): T {
  if (answer.kind === 'refused') {
    throw new Error(answer.message);
  }
  return answer.data;
}

/**
 * A server function's data, or its refusal thrown with its words. A server
 * function answers its refusals, so one that fails, or a refusal without
 * words, means it did not answer: Next.js hands the browser such a failure
 * with no message, or with one that says nothing to the operator. It then
 * throws `noAnswer`, so a failure always names a reason.
 */
export async function dataFrom<T>(serverFunction: () => Promise<PluginAnswer<T>>, noAnswer: string): Promise<T> {
  let answer: PluginAnswer<T>;
  try {
    answer = await serverFunction();
  } catch {
    throw new Error(noAnswer);
  }
  return dataOf(answer.kind === 'refused' && answer.message.trim() === '' ? { kind: 'refused', message: noAnswer } : answer);
}
