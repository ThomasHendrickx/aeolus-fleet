import { z } from 'zod';

import { idSchema } from '../ids/index.js';

/**
 * A ping: a message from argo to one crewed ship that its session answers
 * with pong, proving the ship's model is working, not only its process. It
 * travels as any message does, told apart by this reserved content type,
 * which only the ping call sends.
 */
export const PING_CONTENT_TYPE = 'application/vnd.aeolus.ping';

/**
 * Whether a content type is the ping's: media types compare without case and
 * without their parameters (RFC 9110), so no spelling of it slips past.
 */
export function isPingContentType(contentType: string): boolean {
  const [essence = ''] = contentType.split(';');
  return essence.trim().toLowerCase() === PING_CONTENT_TYPE;
}

/** Input of `fleet.ping`: the crewed ship to ping. */
export const pingShipInputSchema = z.object({ shipId: idSchema('ship') });

export type PingShipInput = z.infer<typeof pingShipInputSchema>;

/**
 * Output of `fleet.ping`: the ship's open ping, when it was sent, and whether
 * this call sent it. Pings never stack: while one is unanswered, ping answers
 * with that one.
 */
export const pingShipOutputSchema = z.object({
  messageId: idSchema('message'),
  sentAt: z.iso.datetime(),
  isNew: z.boolean(),
});

export type PingShipOutput = z.infer<typeof pingShipOutputSchema>;

/** Input of `pong`: the ping delivery the ship answers. */
export const pongInputSchema = z.object({ deliveryId: idSchema('delivery') });

export type PongInput = z.infer<typeof pongInputSchema>;

/** Output of `pong`: nothing; the OK is the answer. */
export const pongOutputSchema = z.strictObject({});

export type PongOutput = z.infer<typeof pongOutputSchema>;
