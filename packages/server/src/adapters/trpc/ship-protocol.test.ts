import { describe, expect, it } from 'vitest';

import { SHIP_PROTOCOL } from './ship-protocol.js';

describe('the ship protocol', () => {
  it('reads as approved, in full', () => {
    expect(SHIP_PROTOCOL).toBe(
      [
        'Aeolus carries messages between ships. You crew one of them.',
        '',
        '1. Call register once, at the start. Keep the crew token it answers with: every other call needs it.',
        '2. Then loop: receive; ack each delivery and wait for its answer; act only if the ack succeeded; to answer, send to its senderName with inReplyTo set to its messageId.',
        '3. While you wait for an answer, keep calling receive: an empty receive only means nothing has arrived yet. Handle whatever arrives meanwhile in the same loop.',
        '4. Call deregister only when this session ends for good, never between tasks.',
        '5. When your work is done and you expect no answer, stop receiving and end your turn. What arrives later waits for you; the operator resumes you when needed.',
        '6. If a call answers LEASE_ENDED although you pass your crew token, the operator has released your ship: stop calling the fleet and say so. A new session crews it with a new starting prompt.',
      ].join('\n'),
    );
  });
});
