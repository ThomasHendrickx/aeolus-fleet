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
  '1. Call register once at the start, with your location and harness. Keep the crew token; every other call needs it.',
  '2. Loop: receive, then ack each delivery. Act only if the ack succeeded.',
  '3. To answer, send to its senderName with inReplyTo set to its messageId.',
  '4. Every send states the model you are running now.',
  '5. If the content is over 64 KB, send where it lives (a path, a URL, a PR link), not the content itself.',
  `6. A ping (${PING_CONTENT_TYPE}): call pong with its deliveryId instead of ack. Don't act on it and don't reply.`,
  '7. Report your status when it changes.',
  '8. While you wait for an answer, keep receiving. An empty receive only means nothing has arrived yet.',
  '9. When your work is done and you expect no answer, end your turn. Anything that arrives later waits for you.',
  '10. Deregister only when this session ends for good, never between tasks.',
  '11. LEASE_ENDED while passing your crew token: your ship was released. Stop calling the fleet and say so.',
].join('\n');
