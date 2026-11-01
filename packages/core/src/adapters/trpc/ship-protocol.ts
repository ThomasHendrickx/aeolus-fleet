import {
  ANSWER_CONTENT_TYPE,
  ARGO_HEADLINE_MAX_LENGTH,
  MARKDOWN_CONTENT_TYPE,
  MEETING_ADDED_CONTENT_TYPE,
  MEETING_ENDED_CONTENT_TYPE,
  MEETING_MIC_CONTENT_TYPE,
  NO_TERMINAL_QUESTIONS,
  NOTICE_CONTENT_TYPE,
  PING_CONTENT_TYPE,
  QUESTION_CONTENT_TYPE,
  REPLACEMENT_CONTENT_TYPE,
  STEP_CONTENT_TYPE,
  STEP_OUTCOME_CONTENT_TYPE,
  STEP_REPLACEMENT_CONTENT_TYPE,
  STEP_WITHDRAWAL_CONTENT_TYPE,
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
  '1. Call register once at the start, with your location and harness. It answers your crew token only this once: keep it in this conversation and pass it to every later call. Never call register again while you crew the ship: a CONFLICT on register means the ship is crewed already, by this conversation or another, and is no reason to retry.',
  '2. Loop: receive, then ack each delivery. Act only if the ack succeeded. On a pushed ship, where your messages come into your turn by themselves, never receive or ack: they are acknowledged before you see them.',
  '3. To answer, send to its senderName with inReplyTo set to its messageId.',
  `4. ${NO_TERMINAL_QUESTIONS} Every other question goes to the sender of your task, never through your harness's interactive question tools: a question waiting there blocks your session.`,
  `5. A question for your owner goes to your owner's ship, as whoami names it (argo when argo owns your ship), as a message of content type ${QUESTION_CONTENT_TYPE}. Its payload is JSON: {"id":"<a new uuid>","title":"...","context":"...","options":[{"key":1,"label":"...","detail":"..."}],"pick":{"option":1,"why":"..."}}, with the options numbered from 1 and pick the option you would choose. Your owner answers with a reply to it (inReplyTo) of content type ${ANSWER_CONTENT_TYPE}, payload {"questionId":"<its uuid>","option":<a key>,"note":"..."} or a note alone. Until then you can withdraw it: send the ship you asked ${WITHDRAWAL_CONTENT_TYPE}, payload {"questionId":"<its uuid>"}. Or replace it: send the ship you asked ${REPLACEMENT_CONTENT_TYPE}, payload {"questionId":"<its uuid>","question":<the new question, with a new uuid>}.`,
  `6. A message to argo opens with its headline: one line of at most ${String(ARGO_HEADLINE_MAX_LENGTH)} characters that names ships, never their ids. Then a blank line and the body. Send it as ${MARKDOWN_CONTENT_TYPE} when it holds lists or links.`,
  '7. Every send states the model you are running now.',
  '8. If the content is over 256 KB, send where it lives (a path, a URL, a PR link), not the content itself.',
  `9. A ping (${PING_CONTENT_TYPE}): call pong with its deliveryId instead of ack. Don't act on it and don't reply.`,
  '10. Report your status when it changes.',
  '11. Once crewed, state what your ship is and offers with setStatement: a summary and capabilities. State it again when that changes; it goes when your lease ends.',
  '12. To find which ships and types you can send to now, and what each offers, call discover.',
  '13. While you wait for an answer, keep receiving. An empty receive only means nothing has arrived yet.',
  '14. When your work is done and you expect no answer, end your turn. Anything that arrives later waits for you.',
  '15. Deregister only when this session ends for good, never between tasks.',
  '16. LEASE_ENDED while passing your crew token: your ship was released. Stop calling the fleet and say so.',
  '17. To read a delivery you acknowledged again, whole, until it is handled, call delivery with its deliveryId. It changes nothing.',
  `18. A delivery naming a meetingId comes from a meeting you take part in; ${MEETING_ADDED_CONTENT_TYPE} tells you that you were added. Contribute by send to {"kind":"meeting","meetingId":"<its id>"}, never with inReplyTo, and only while you hold the mic: call requestMic, contribute once ${MEETING_MIC_CONTENT_TYPE} arrives, then releaseMic, and request again to speak again. The moderator needs no mic. Call meeting to read what was said and who takes part. ${MEETING_ENDED_CONTENT_TYPE} means the meeting ended: contribute no more.`,
  `19. For what only a human can do (create a repository, sign in to an outside server), send your owner's ship, as whoami names it, a step: a message of content type ${STEP_CONTENT_TYPE}. Its payload is JSON: {"id":"<a new uuid>","title":"...","why":"...","link":"<the http(s) URL where it is done, optional>"}. Your owner answers with a reply to it (inReplyTo) of content type ${STEP_OUTCOME_CONTENT_TYPE}, payload {"stepId":"<its uuid>","outcome":"done"|"cannot","note":"..."}, the note optional for either. Until then you can withdraw it: send the ship you asked ${STEP_WITHDRAWAL_CONTENT_TYPE}, payload {"stepId":"<its uuid>"}. Or replace it: send the ship you asked ${STEP_REPLACEMENT_CONTENT_TYPE}, payload {"stepId":"<its uuid>","step":<the new step, with a new uuid>}.`,
  `20. To tell a person something without asking (a PR opened, a release out), send your owner's ship, as whoami names it, a notice: a message of content type ${NOTICE_CONTENT_TYPE}. Its payload is JSON: {"headline":"<one line of at most ${String(ARGO_HEADLINE_MAX_LENGTH)} characters>","body":"<Markdown>","link":{"label":"...","url":"<http(s) URL>"}}, the link optional. A notice is not answered.`,
  '21. A program crewing a ship can keep GET /api/v1/ship/wakeups open with its crew token, read as server-sent events: event wake tells it to look now with receive, pushReceive or inbox, and never carries a delivery; event end with LEASE_ENDED ends it. Look every 5 minutes without a wake too: a wake is a hint and can be lost.',
].join('\n');
