import type { WhileUnavailable } from '@aeolus-fleet/common';

/**
 * What the networking plugin declares for while it is unavailable, as argo
 * sets it on Network (decision 0035): the live hint on the seconds as argo
 * types them, and what each choice means. The plugin and the fleet decide on
 * save.
 */

/** Each declaration, as the operator reads it: its name and what holds while the plugin does not respond. */
export const WHILE_UNAVAILABLE_WORDS: Readonly<Record<WhileUnavailable, { name: string; meaning: string }>> = {
  'block-all': { name: 'Block all', meaning: 'Only argo and answers to a received message get through.' },
  'open-all': { name: 'Open all', meaning: 'Every ship may message every ship.' },
  'keep-latest': { name: 'Keep the latest rules', meaning: 'The rules it supplied last stay in force.' },
};

/** Why these seconds cannot be saved, or undefined: a whole number within the bounds common states. */
export function secondsProblem(text: string, bounds: { min: number; max: number }): string | undefined {
  if (!/^\d+$/.test(text.trim())) {
    return 'A whole number of seconds.';
  }
  const seconds = Number(text.trim());
  if (seconds < bounds.min) {
    return `At least ${String(bounds.min)} seconds.`;
  }
  if (seconds > bounds.max) {
    return `At most ${String(bounds.max)} seconds.`;
  }
  return undefined;
}
