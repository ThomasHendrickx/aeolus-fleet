import { PING_CONTENT_TYPE } from '@aeolus-fleet/common';

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
  '1. Call register once, at the start. Keep the crew token it answers with: every other call needs it.',
  '2. Then loop: receive; ack each delivery and wait for its answer; act only if the ack succeeded; to answer, send to its senderName with inReplyTo set to its messageId.',
  `3. A delivery whose contentType is ${PING_CONTENT_TYPE} is a ping from the operator: answer it with pong and its deliveryId instead of ack. Do not act on it and do not reply with a message.`,
  '4. While you wait for an answer, keep calling receive: an empty receive only means nothing has arrived yet. Handle whatever arrives meanwhile in the same loop.',
  '5. Call deregister only when this session ends for good, never between tasks.',
  '6. When your work is done and you expect no answer, stop receiving and end your turn. What arrives later waits for you; the operator resumes you when needed.',
  '7. If a call answers LEASE_ENDED although you pass your crew token, the operator has released your ship: stop calling the fleet and say so. A new session crews it with a new starting prompt.',
].join('\n');
