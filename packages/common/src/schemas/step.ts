import { z } from 'zod';

import { essenceOf } from './content-type.js';

/**
 * Steps (docs/design/bridge, CC14): a ship asks a person for what only a
 * human can do (create a repository, sign in to an outside server) by sending
 * the person's ship a message of the step content type; the person answers
 * with a reply of the step outcome content type. Both payloads are data only:
 * the fleet carries them as any message. The asking ship withdraws a step, or
 * replaces it with a new one, by a message of its own content type naming the
 * step's uuid, as for a question (decision 0038).
 */
export const STEP_CONTENT_TYPE = 'application/vnd.aeolus.step+json';
export const STEP_OUTCOME_CONTENT_TYPE = 'application/vnd.aeolus.step-outcome+json';
export const STEP_WITHDRAWAL_CONTENT_TYPE = 'application/vnd.aeolus.step-withdrawal+json';
export const STEP_REPLACEMENT_CONTENT_TYPE = 'application/vnd.aeolus.step-replacement+json';

export function isStepContentType(contentType: string): boolean {
  return essenceOf(contentType) === STEP_CONTENT_TYPE;
}

export function isStepOutcomeContentType(contentType: string): boolean {
  return essenceOf(contentType) === STEP_OUTCOME_CONTENT_TYPE;
}

export function isStepWithdrawalContentType(contentType: string): boolean {
  return essenceOf(contentType) === STEP_WITHDRAWAL_CONTENT_TYPE;
}

export function isStepReplacementContentType(contentType: string): boolean {
  return essenceOf(contentType) === STEP_REPLACEMENT_CONTENT_TYPE;
}

const textSchema = z.string().min(1);

/** A step: its own uuid, a title, why it is needed, and the link where it is done, when there is one (an http(s) URL). */
export const stepSchema = z.object({
  id: z.uuid(),
  title: textSchema,
  why: z.string(),
  link: z.url({ protocol: /^https?$/ }).optional(),
});

export type Step = z.infer<typeof stepSchema>;

/** A withdrawal: the uuid of the step the asker withdraws. */
export const stepWithdrawalSchema = z.object({ stepId: z.uuid() });

/** A replacement: the uuid of the step the asker replaces, and the new step, with a uuid of its own. */
export const stepReplacementSchema = z
  .object({ stepId: z.uuid(), step: stepSchema })
  .refine(({ stepId, step }) => step.id !== stepId, {
    message: 'The new step has a uuid of its own',
    path: ['step', 'id'],
  });

/** How a step ended: the person did it, or cannot. */
export const STEP_OUTCOMES = ['done', 'cannot'] as const;
export const stepOutcomeKindSchema = z.enum(STEP_OUTCOMES);
export type StepOutcomeKind = z.infer<typeof stepOutcomeKindSchema>;

/** A step outcome: the step's uuid, done or cannot, and an optional note for either. */
export const stepOutcomeSchema = z.object({
  stepId: z.uuid(),
  outcome: stepOutcomeKindSchema,
  note: textSchema.optional(),
});

export type StepOutcome = z.infer<typeof stepOutcomeSchema>;
