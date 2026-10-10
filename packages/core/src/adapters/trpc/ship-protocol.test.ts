import { NO_TERMINAL_QUESTIONS } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { SHIP_PROTOCOL } from './ship-protocol.js';

describe('the ship protocol', () => {
  it('reads as approved, in full', () => {
    expect(SHIP_PROTOCOL).toBe(
      [
        'Aeolus carries messages between ships. You crew one of them.',
        '',
        '1. Call register once at the start, with your location and harness. Keep the crew token; every other call needs it.',
        '2. Loop: receive, then ack each delivery. Act only if the ack succeeded.',
        '3. To answer, send to its senderName with inReplyTo set to its messageId.',
        "4. No human reads this terminal. Never ask here; ask over the fleet. A question only the operator can answer goes to argo. Ask your questions over the fleet, to the sender of your task, never through your harness's interactive question tools: nobody watches your session, and a question waiting there blocks it.",
        '5. Every send states the model you are running now.',
        '6. If the content is over 64 KB, send where it lives (a path, a URL, a PR link), not the content itself.',
        "7. A ping (application/vnd.aeolus.ping): call pong with its deliveryId instead of ack. Don't act on it and don't reply.",
        '8. Report your status when it changes.',
        '9. While you wait for an answer, keep receiving. An empty receive only means nothing has arrived yet.',
        '10. When your work is done and you expect no answer, end your turn. Anything that arrives later waits for you.',
        '11. Deregister only when this session ends for good, never between tasks.',
        '12. LEASE_ENDED while passing your crew token: your ship was released. Stop calling the fleet and say so.',
      ].join('\n'),
    );
  });

  it('tells every ship the line the trierarch gives its sessions: no human reads its terminal, ask over the fleet, and argo for what only the operator can answer (#588)', () => {
    expect(SHIP_PROTOCOL.split('\n').find((line) => line.startsWith('4. '))).toContain(NO_TERMINAL_QUESTIONS);
  });
});
