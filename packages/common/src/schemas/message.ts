import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { shipHandleSchema } from './fleet.js';

/**
 * Inputs and outputs of sending a message (`ship.send`): who it is for, its
 * payload and content type, the sender's idempotency key, and the message it
 * replies to.
 */

/**
 * A payload is at most 64 KB (ADR 0006): a message carries a reference and an
 * instruction, not the content itself.
 */
export const PAYLOAD_MAX_BYTES = 64 * 1024;

const utf8 = new TextEncoder();

/**
 * The size of a payload serialized: the bytes of its text in UTF-8, as the
 * database stores it and counts it.
 */
export function payloadBytes(payload: string): number {
  return utf8.encode(payload).byteLength;
}

/** A payload is text with a content type: JSON or plain text. Never parsed by the fleet. */
export const CONTENT_TYPES = ['application/json', 'text/plain'] as const;
export const contentTypeSchema = z.enum(CONTENT_TYPES);
export type ContentType = z.infer<typeof contentTypeSchema>;

/** The longest idempotency key a sender may give. It is opaque: any text of 1 to this many characters. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 256;

/**
 * Who a message is for (docs/blueprint.md, "Selector"): one ship, by id or by
 * name, or any ship of a type. A name is resolved to the ship's id at send time.
 */
export const selectorSchema = z.union([
  z.strictObject({ kind: z.literal('ship'), shipId: idSchema('ship') }),
  z.strictObject({ kind: z.literal('ship'), name: shipHandleSchema }),
  z.strictObject({ kind: z.literal('type'), type: shipHandleSchema }),
]);

export type SelectorInput = z.infer<typeof selectorSchema>;

/** Input of `ship.send`. The sender is the calling ship, never named in the input. */
export const sendInputSchema = z.object({
  selector: selectorSchema,
  payload: z
    .string()
    .refine(
      (payload) => payloadBytes(payload) <= PAYLOAD_MAX_BYTES,
      `A payload is at most ${PAYLOAD_MAX_BYTES} bytes (64 KB) in UTF-8`,
    ),
  contentType: contentTypeSchema,
  idempotencyKey: z.string().min(1).max(IDEMPOTENCY_KEY_MAX_LENGTH),
  /** The id of the message, in the same fleet, that this one replies to. */
  inReplyTo: idSchema('message').optional(),
});

export type SendInput = z.infer<typeof sendInputSchema>;

/** Output of `ship.send`: the message's id, the original one when the idempotency key was used before. */
export const sendOutputSchema = z.object({ messageId: idSchema('message') });

export type SendOutput = z.infer<typeof sendOutputSchema>;
