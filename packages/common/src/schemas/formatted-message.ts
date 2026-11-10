import { z } from 'zod';

import { idempotencyKeySchema } from './idempotency-key.js';
import { modelSchema, shipSelectorSchema } from './message.js';
import { questionSchema } from './question.js';
import { stepSchema } from './step.js';

/**
 * Inputs of `ship.ask`, `ship.step` and `ship.withdraw` (docs/design/ask-and-step):
 * the fields of a question or step, or the uuid of the one withdrawn, for one
 * ship. Core builds the JSON and its content type and sends it as `ship.send`
 * does, so each answers as send does (sendOutputSchema). The ship supplies the
 * uuid, and keeps it, the recipient and the key for an identical retry.
 */

/** What every formatted message names besides its fields: one ship, the sender's model, as send states it, and the key. */
const formattedSendShape = {
  selector: shipSelectorSchema,
  /** The exact model the sending session runs now. Every ship states it; argo states none. */
  model: modelSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
};

/** Input of `ship.ask`: a question's fields, checked by common's question schema, for one ship. */
export const askInputSchema = questionSchema.safeExtend(formattedSendShape);

export type AskInput = z.infer<typeof askInputSchema>;

/** Input of `ship.step`: a step's fields, checked by common's step schema, for one ship. */
export const stepInputSchema = stepSchema.safeExtend(formattedSendShape);

export type StepInput = z.infer<typeof stepInputSchema>;

/** What a withdrawal names: a question's uuid or a step's, exactly one of them. */
export const withdrawalTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('question'), questionId: z.uuid() }),
  z.strictObject({ kind: z.literal('step'), stepId: z.uuid() }),
]);

export type WithdrawalTarget = z.infer<typeof withdrawalTargetSchema>;

/** Input of `ship.withdraw`: the question or step withdrawn, for the ship it was sent to. */
export const withdrawInputSchema = z.object({ ...formattedSendShape, target: withdrawalTargetSchema });

export type WithdrawInput = z.infer<typeof withdrawInputSchema>;
