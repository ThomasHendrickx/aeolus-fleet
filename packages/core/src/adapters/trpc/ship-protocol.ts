import {
  ANSWER_CONTENT_TYPE,
  NO_TERMINAL_QUESTIONS,
  PING_CONTENT_TYPE,
  QUESTION_CONTENT_TYPE,
  REPLACEMENT_CONTENT_TYPE,
  WITHDRAWAL_CONTENT_TYPE,
} from '@aeolus-fleet/common';

/**
 * The ship protocol: how a session crewing a ship uses the ship calls, and
 * when. The MCP server sends it as its instructions when a client connects,
 * and the OpenAPI spec opens with it, so both doors state it in one text
 * (ADR 0004). It is one of three layers, and none repeats another: the
 * starting prompt says which ship the session crews, this says how to crew
 * it, and each call's description (ship.ts) states that call's own rules.
 */
export const SHIP_PROTOCOL = [
  'Aeolus carries messages between ships. You crew one of them.',
  '',
  '1. Call register once at the start, with your location and harness. Keep the crew token; every other call needs it.',
  '2. Loop: receive, then ack each delivery. Act only if the ack succeeded. On a pushed ship, where your messages come into your turn by themselves, never receive or ack: they are acknowledged before you see them.',
  '3. To answer, send to its senderName with inReplyTo set to its messageId.',
  `4. ${NO_TERMINAL_QUESTIONS} Every other question goes to the sender of your task, never through your harness's interactive question tools: a question waiting there blocks your session.`,
  `5. A question for argo is a message of content type ${QUESTION_CONTENT_TYPE}. Its payload is JSON: {"id":"<a new uuid>","title":"...","context":"...","options":[{"key":1,"label":"...","detail":"..."}],"pick":{"option":1,"why":"..."}}, with the options numbered from 1 and pick the option you would choose. argo answers with a reply to it (inReplyTo) of content type ${ANSWER_CONTENT_TYPE}, payload {"questionId":"<its uuid>","option":<a key>,"note":"..."} or a note alone. Until then you can withdraw it: send argo ${WITHDRAWAL_CONTENT_TYPE}, payload {"questionId":"<its uuid>"}. Or replace it: send argo ${REPLACEMENT_CONTENT_TYPE}, payload {"questionId":"<its uuid>","question":<the new question, with a new uuid>}.`,
  '6. Every send states the model you are running now.',
  '7. If the content is over 64 KB, send where it lives (a path, a URL, a PR link), not the content itself.',
  `8. A ping (${PING_CONTENT_TYPE}): call pong with its deliveryId instead of ack. Don't act on it and don't reply.`,
  '9. Report your status when it changes.',
  '10. While you wait for an answer, keep receiving. An empty receive only means nothing has arrived yet.',
  '11. When your work is done and you expect no answer, end your turn. Anything that arrives later waits for you.',
  '12. Deregister only when this session ends for good, never between tasks.',
  '13. LEASE_ENDED while passing your crew token: your ship was released. Stop calling the fleet and say so.',
].join('\n');
