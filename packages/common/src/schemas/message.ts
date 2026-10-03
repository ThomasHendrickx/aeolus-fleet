import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { shipHandleSchema } from './fleet.js';
import { idempotencyKeySchema } from './idempotency-key.js';

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

/** The longest content type a sender may give, parameters included. */
export const CONTENT_TYPE_MAX_LENGTH = 256;

/** A payload's content type when its sender does not say. */
export const CONTENT_TYPE_DEFAULT = 'text/plain';

// A media type as RFC 9110 defines it ("Media Type"): type "/" subtype, then
// parameters, each `;` name `=` a token or a quoted string, with optional
// spaces or tabs around the `;`. Empty parameters are allowed, as there.
const TOKEN = "[!#$%&'*+\\-.^_`|~0-9A-Za-z]+";
const QUOTED_STRING = '"(?:[\\t \\x21\\x23-\\x5B\\x5D-\\x7E\\x80-\\xFF]|\\\\[\\t \\x21-\\x7E\\x80-\\xFF])*"';
const SPACE = '[ \\t]*';
const MEDIA_TYPE = new RegExp(`^${TOKEN}/${TOKEN}(?:${SPACE};${SPACE}(?:${TOKEN}=(?:${TOKEN}|${QUOTED_STRING}))?)*$`);

/** Whether the value is a well-formed media type: type/subtype with optional parameters (RFC 9110). */
export function isMediaType(value: string): boolean {
  return MEDIA_TYPE.test(value);
}

const CONTENT_TYPE_MESSAGE = `A content type is a media type such as text/plain or application/json; charset=utf-8, of at most ${CONTENT_TYPE_MAX_LENGTH} characters`;

/**
 * A payload's content type: any well-formed media type, taken and passed on
 * exactly as sent, case and parameters included. The fleet never reads the
 * payload by it (ADR 0016: no policy).
 */
export const contentTypeSchema = z
  .string()
  .max(CONTENT_TYPE_MAX_LENGTH, CONTENT_TYPE_MESSAGE)
  .refine(isMediaType, CONTENT_TYPE_MESSAGE);

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
  /** Without it, the payload is text/plain. */
  contentType: contentTypeSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
  /** The id of the message, in the same fleet, that this one replies to. */
  inReplyTo: idSchema('message').optional(),
});

export type SendInput = z.infer<typeof sendInputSchema>;

/** Output of `ship.send`: the message's id, the original one when the idempotency key was used before. */
export const sendOutputSchema = z.object({ messageId: idSchema('message') });

export type SendOutput = z.infer<typeof sendOutputSchema>;
