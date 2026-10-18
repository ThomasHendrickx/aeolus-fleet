import {
  ANSWER_CONTENT_TYPE,
  ARGO_HEADLINE_MAX_LENGTH,
  MARKDOWN_CONTENT_TYPE,
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
        '1. Call register once at the start, with your location and harness. It answers your crew token only this once: keep it in this conversation and pass it to every later call. Never call register again while you crew the ship: a CONFLICT on register means the ship is crewed already, by this conversation or another, and is no reason to retry.',
        '2. Loop: receive, then ack each delivery. Act only if the ack succeeded. On a pushed ship, where your messages come into your turn by themselves, never receive or ack: they are acknowledged before you see them.',
        '3. To answer, send to its senderName with inReplyTo set to its messageId.',
        "4. No human reads this terminal. Never ask here; ask over the fleet. A question only a human can answer goes to your ship's owner (argo when argo owns your ship). Every other question goes to the sender of your task, never through your harness's interactive question tools: a question waiting there blocks your session.",
        '5. A question for your owner goes to your owner\'s ship, as whoami names it (argo when argo owns your ship), as a message of content type application/vnd.aeolus.question+json. Its payload is JSON: {"id":"<a new uuid>","title":"...","context":"...","options":[{"key":1,"label":"...","detail":"..."}],"pick":{"option":1,"why":"..."}}, with the options numbered from 1 and pick the option you would choose. Your owner answers with a reply to it (inReplyTo) of content type application/vnd.aeolus.answer+json, payload {"questionId":"<its uuid>","option":<a key>,"note":"..."} or a note alone. Until then you can withdraw it: send the ship you asked application/vnd.aeolus.question-withdrawal+json, payload {"questionId":"<its uuid>"}. Or replace it: send the ship you asked application/vnd.aeolus.question-replacement+json, payload {"questionId":"<its uuid>","question":<the new question, with a new uuid>}.',
        '6. A message to argo opens with its headline: one line of at most 80 characters that names ships, never their ids. Then a blank line and the body. Send it as text/markdown when it holds lists or links.',
        '7. Every send states the model you are running now.',
        '8. If the content is over 64 KB, send where it lives (a path, a URL, a PR link), not the content itself.',
        "9. A ping (application/vnd.aeolus.ping): call pong with its deliveryId instead of ack. Don't act on it and don't reply.",
        '10. Report your status when it changes.',
        '11. Once crewed, state what your ship is and offers with setStatement: a summary and capabilities. State it again when that changes; it goes when your lease ends.',
        '12. To find which ships and types you can send to now, and what each offers, call discover.',
        '13. While you wait for an answer, keep receiving. An empty receive only means nothing has arrived yet.',
        '14. When your work is done and you expect no answer, end your turn. Anything that arrives later waits for you.',
        '15. Deregister only when this session ends for good, never between tasks.',
        '16. LEASE_ENDED while passing your crew token: your ship was released. Stop calling the fleet and say so.',
      ].join('\n'),
    );
  });

  it('tells a session that register answers the crew token once, to keep it in the conversation for every later call, and that a CONFLICT on register is no reason to register again', () => {
    const rule = SHIP_PROTOCOL.split('\n').find((line) => line.startsWith('1. '));

    expect(rule).toContain('only this once: keep it in this conversation and pass it to every later call');
    expect(rule).toContain('Never call register again while you crew the ship');
    expect(rule).toContain('a CONFLICT on register means the ship is crewed already, by this conversation or another, and is no reason to retry');
  });

  it("tells every ship the line the trierarch gives its sessions: no human reads its terminal, ask over the fleet, and its ship's owner for what only a human can answer (#588)", () => {
    expect(SHIP_PROTOCOL.split('\n').find((line) => line.startsWith('4. '))).toContain(NO_TERMINAL_QUESTIONS);
  });

  it("tells every ship how to ask its owner's ship a question, as whoami names it, withdraw or replace it, and how its answer arrives, with the content types of decision 0038 (#684, decision 0045)", () => {
    const rule = SHIP_PROTOCOL.split('\n').find((line) => line.startsWith('5. '));

    for (const contentType of [QUESTION_CONTENT_TYPE, ANSWER_CONTENT_TYPE, WITHDRAWAL_CONTENT_TYPE, REPLACEMENT_CONTENT_TYPE]) {
      expect(rule).toContain(contentType);
    }
  });

  it('tells every ship to withdraw or replace a question with a message to the ship it asked, not to the owner whoami names now (decision 0038, #929)', () => {
    const rule = SHIP_PROTOCOL.split('\n').find((line) => line.startsWith('5. '));

    expect(rule).toContain(`withdraw it: send the ship you asked ${WITHDRAWAL_CONTENT_TYPE}`);
    expect(rule).toContain(`replace it: send the ship you asked ${REPLACEMENT_CONTENT_TYPE}`);
  });

  it('tells every ship that a message to argo opens with a headline of at most 80 characters, then a blank line and the body, in markdown for lists and links (#849)', () => {
    const rule = SHIP_PROTOCOL.split('\n').find((line) => line.startsWith('6. '));

    expect(rule).toContain(`at most ${String(ARGO_HEADLINE_MAX_LENGTH)} characters`);
    expect(rule).toContain(MARKDOWN_CONTENT_TYPE);
  });

  it('says ask over the fleet once, in the trierarch line, not again after it (#592)', () => {
    expect(SHIP_PROTOCOL.match(/over the fleet/g)).toHaveLength(1);
  });
});
