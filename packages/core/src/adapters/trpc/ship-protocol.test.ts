import {
  ANSWER_CONTENT_TYPE,
  NO_TERMINAL_QUESTIONS,
  QUESTION_CONTENT_TYPE,
  REPLACEMENT_CONTENT_TYPE,
  WITHDRAWAL_CONTENT_TYPE,
} from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { SHIP_PROTOCOL } from './ship-protocol.js';

describe('the ship protocol', () => {
  it('reads as approved, in full', () => {
    expect(SHIP_PROTOCOL).toBe(
      [
        'Aeolus carries messages between ships. You crew one of them.',
        '',
        '1. Call register once at the start, with your location and harness. Keep the crew token; every other call needs it.',
        '2. Loop: receive, then ack each delivery. Act only if the ack succeeded. On a pushed ship, where your messages come into your turn by themselves, never receive or ack: they are acknowledged before you see them.',
        '3. To answer, send to its senderName with inReplyTo set to its messageId.',
        "4. No human reads this terminal. Never ask here; ask over the fleet. A question only the operator can answer goes to argo. Every other question goes to the sender of your task, never through your harness's interactive question tools: a question waiting there blocks your session.",
        '5. A question for argo is a message of content type application/vnd.aeolus.question+json. Its payload is JSON: {"id":"<a new uuid>","title":"...","context":"...","options":[{"key":1,"label":"...","detail":"..."}],"pick":{"option":1,"why":"..."}}, with the options numbered from 1 and pick the option you would choose. argo answers with a reply to it (inReplyTo) of content type application/vnd.aeolus.answer+json, payload {"questionId":"<its uuid>","option":<a key>,"note":"..."} or a note alone. Until then you can withdraw it: send argo application/vnd.aeolus.question-withdrawal+json, payload {"questionId":"<its uuid>"}. Or replace it: send argo application/vnd.aeolus.question-replacement+json, payload {"questionId":"<its uuid>","question":<the new question, with a new uuid>}.',
        '6. Every send states the model you are running now.',
        '7. If the content is over 64 KB, send where it lives (a path, a URL, a PR link), not the content itself.',
        "8. A ping (application/vnd.aeolus.ping): call pong with its deliveryId instead of ack. Don't act on it and don't reply.",
        '9. Report your status when it changes.',
        '10. While you wait for an answer, keep receiving. An empty receive only means nothing has arrived yet.',
        '11. When your work is done and you expect no answer, end your turn. Anything that arrives later waits for you.',
        '12. Deregister only when this session ends for good, never between tasks.',
        '13. LEASE_ENDED while passing your crew token: your ship was released. Stop calling the fleet and say so.',
      ].join('\n'),
    );
  });

  it('tells every ship the line the trierarch gives its sessions: no human reads its terminal, ask over the fleet, and argo for what only the operator can answer (#588)', () => {
    expect(SHIP_PROTOCOL.split('\n').find((line) => line.startsWith('4. '))).toContain(NO_TERMINAL_QUESTIONS);
  });

  it('tells every ship how to ask argo a question, withdraw or replace it, and how its answer arrives, with the content types of decision 0038 (#684)', () => {
    const rule = SHIP_PROTOCOL.split('\n').find((line) => line.startsWith('5. '));

    for (const contentType of [QUESTION_CONTENT_TYPE, ANSWER_CONTENT_TYPE, WITHDRAWAL_CONTENT_TYPE, REPLACEMENT_CONTENT_TYPE]) {
      expect(rule).toContain(contentType);
    }
  });

  it('says ask over the fleet once, in the trierarch line, not again after it (#592)', () => {
    expect(SHIP_PROTOCOL.match(/over the fleet/g)).toHaveLength(1);
  });
});
