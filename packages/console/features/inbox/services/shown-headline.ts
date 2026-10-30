import type { MessageEntry } from '../../../lib/inbox-entry';

/** What stands for a sealed payload while its company key is not reachable (decision 0068, N1). */
export const KEY_NOT_REACHABLE_WORDS = 'Sealed, key not reachable';

/** A message's headline as the inbox lists it: its own, or that its sealed payload's key is not reachable. */
export function shownHeadlineOf(message: Pick<MessageEntry, 'sealing' | 'text'>): string {
  return message.sealing === 'keyNotReachable' ? KEY_NOT_REACHABLE_WORDS : message.text.headline;
}
