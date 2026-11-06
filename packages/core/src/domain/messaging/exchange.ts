import { isPingContentType } from '@aeolus-fleet/common';

import type { Message } from './message.js';

/**
 * An exchange (docs/design/exchange-read, E1): what one ship and one other
 * ship said to each other, every message one of them sent that reached the
 * other, by name, by type once the other claimed it, or by label. A meeting's
 * messages are the meeting's (decision 0061), and a ping is a check of the
 * ship, not something said, so neither is in an exchange.
 */
export function isInExchange(message: Pick<Message, 'meetingId' | 'contentType'>): boolean {
  return message.meetingId === null && !isPingContentType(message.contentType);
}
