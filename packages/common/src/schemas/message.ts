import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { PAYLOAD_MAX_BYTES, payloadBytes } from '../rules/payload.js';
import { shipHandleSchema } from './fleet.js';
import { idempotencyKeySchema } from './idempotency-key.js';
import { SHIP_LABELS_MAX } from './label.js';

/**
 * Inputs and outputs of sending a message (`ship.send`): who it is for, its
 * payload and content type, the model the sender runs, the sender's
 * idempotency key, and the message it replies to.
 */

export { PAYLOAD_MAX_BYTES, payloadBytes } from '../rules/payload.js';

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

/** The longest model id a session may state. */
export const MODEL_MAX_LENGTH = 100;

/**
 * The model a session runs, as it states it on each send (docs/blueprint.md,
 * "Model"): its exact id, such as claude-opus-5-5, or auto when the harness
 * chooses the model per request, trimmed, without spaces. Self-reported: the
 * fleet stores it and never verifies it, not even auto against the harness.
 */
export const modelSchema = z
  .string()
  .trim()
  .min(1, 'A model is the exact model id the session runs, such as claude-opus-5-5')
  .max(MODEL_MAX_LENGTH, `A model is at most ${String(MODEL_MAX_LENGTH)} characters`)
  .regex(/^\S+$/, 'A model id has no spaces');

/**
 * A label selection a message is sent to (decision 0065): one value id up to
 * as many as a ship carries, each once; exact and AND, so a ship carrying
 * every value gets a delivery. Ids only, never texts (decision 0031).
 */
export const labelValuesSelectorSchema = z.strictObject({
  kind: z.literal('label'),
  valueIds: z
    .array(idSchema('labelValue'))
    .min(1, 'A label selection names at least one value id')
    .max(SHIP_LABELS_MAX, `A label selection names at most ${String(SHIP_LABELS_MAX)} value ids, as many as a ship carries`)
    .refine((valueIds) => new Set(valueIds).size === valueIds.length, 'A label selection names each value id once'),
});

/**
 * Who a message is for (docs/blueprint.md, "Selector"): one ship, by id or by
 * name, any ship of a type, every other participant of a meeting (decision
 * 0061), or every ship a label selection names (decision 0065). A name is
 * resolved to the ship's id at send time.
 */
export const selectorSchema = z.union([
  z.strictObject({ kind: z.literal('ship'), shipId: idSchema('ship') }),
  z.strictObject({ kind: z.literal('ship'), name: shipHandleSchema }),
  z.strictObject({ kind: z.literal('type'), type: shipHandleSchema }),
  z.strictObject({ kind: z.literal('meeting'), meetingId: idSchema('meeting') }),
  labelValuesSelectorSchema,
]);

/**
 * What a schedule sends to (decision 0062): one ship, by id or by name, a
 * type, or a label selection resolved at each send time (decision 0065);
 * never a meeting.
 */
export const scheduleSelectorSchema = z.union([
  z.strictObject({ kind: z.literal('ship'), shipId: idSchema('ship') }),
  z.strictObject({ kind: z.literal('ship'), name: shipHandleSchema }),
  z.strictObject({ kind: z.literal('type'), type: shipHandleSchema }),
  labelValuesSelectorSchema,
]);

/** A payload: any text of at most 64 KB in UTF-8 (ADR 0006). */
export const payloadSchema = z
  .string()
  .refine(
    (payload) => payloadBytes(payload) <= PAYLOAD_MAX_BYTES,
    `A payload is at most ${PAYLOAD_MAX_BYTES} bytes (64 KB) in UTF-8`,
  );

export type SelectorInput = z.infer<typeof selectorSchema>;

/** Input of `ship.send`. The sender is the calling ship, never named in the input. */
export const sendInputSchema = z.object({
  selector: selectorSchema,
  payload: payloadSchema,
  /** Without it, the payload is text/plain. */
  contentType: contentTypeSchema.optional(),
  /** The exact model the sending session runs now. Every ship states it; argo states none. */
  model: modelSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
  /** The id of the message, in the same fleet, that this one replies to. */
  inReplyTo: idSchema('message').optional(),
  /** A forced send: act now. Its delivery comes first; it needs messages:force (decision 0040). */
  isForced: z.boolean().optional(),
});

export type SendInput = z.infer<typeof sendInputSchema>;

/** Output of `ship.send`: the message's id, the original one when the idempotency key was used before. */
export const sendOutputSchema = z.object({ messageId: idSchema('message') });

export type SendOutput = z.infer<typeof sendOutputSchema>;
