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
