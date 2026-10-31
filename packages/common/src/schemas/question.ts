import { z } from 'zod';

import { idSchema, type MessageId } from '../ids/index.js';
import { essenceOf } from './content-type.js';

/**
 * Questions to argo (decision 0038): a ship asks the operator by sending a
 * message of the question content type to argo; the console answers it with a
 * reply of the answer content type. Both payloads are data only: the fleet
 * carries them as any message; the console's server reads them. Core only
 * finds a question's withdrawals and replacements by the uuid they name. A question is open until argo
 * sends its answer, whatever its delivery's state. The asking ship withdraws
 * a question, or replaces it with a new one, by a message of its own content
 * type naming the question's uuid.
 */
export const QUESTION_CONTENT_TYPE = 'application/vnd.aeolus.question+json';
export const ANSWER_CONTENT_TYPE = 'application/vnd.aeolus.answer+json';
export const WITHDRAWAL_CONTENT_TYPE = 'application/vnd.aeolus.question-withdrawal+json';
export const REPLACEMENT_CONTENT_TYPE = 'application/vnd.aeolus.question-replacement+json';

export function isQuestionContentType(contentType: string): boolean {
  return essenceOf(contentType) === QUESTION_CONTENT_TYPE;
}

export function isAnswerContentType(contentType: string): boolean {
  return essenceOf(contentType) === ANSWER_CONTENT_TYPE;
}

export function isWithdrawalContentType(contentType: string): boolean {
  return essenceOf(contentType) === WITHDRAWAL_CONTENT_TYPE;
}

export function isReplacementContentType(contentType: string): boolean {
  return essenceOf(contentType) === REPLACEMENT_CONTENT_TYPE;
}

const FIRST_OPTION = 1;

/** An option's number, from 1. */
const optionKeySchema = z.int().min(FIRST_OPTION);

const textSchema = z.string().min(1);

/** An option: its number, a label, and a detail, empty when the asker sent none (#854): a question is its type, not a perfect format. */
const optionSchema = z.object({ key: optionKeySchema, label: textSchema, detail: z.string().default('') });

/** A question: its own uuid, a title, the context to answer from, numbered options, and the asker's pick and why. */
export const questionSchema = z
  .object({
    id: z.uuid(),
    title: textSchema,
    context: z.string(),
    options: z.array(optionSchema).min(1),
    pick: z.object({ option: optionKeySchema, why: textSchema }),
  })
  .refine(({ options }) => new Set(options.map(({ key }) => key)).size === options.length, {
    message: 'Every option has its own number',
    path: ['options'],
  })
  .refine(({ options, pick }) => options.some(({ key }) => key === pick.option), {
    message: 'The pick names one of the options',
    path: ['pick', 'option'],
  });

export type Question = z.infer<typeof questionSchema>;

/** A withdrawal: the uuid of the question the asker withdraws. */
export const withdrawalSchema = z.object({ questionId: z.uuid() });

/** A replacement: the uuid of the question the asker replaces, and the new question, with a uuid of its own. */
export const replacementSchema = z
  .object({ questionId: z.uuid(), question: questionSchema })
  .refine(({ questionId, question }) => question.id !== questionId, {
    message: 'The new question has a uuid of its own',
    path: ['question', 'id'],
  });

/** What the operator answers: one option and an optional note, or a note alone (more context needed, or none of the options). */
export const answerChoiceSchema = z.union([
  z.object({ option: optionKeySchema, note: textSchema.optional() }),
  z.object({ note: textSchema }),
]);

export type AnswerChoice = z.infer<typeof answerChoiceSchema>;

/** An answer: the question's uuid, and one option plus an optional note, or a note alone. */
export const answerSchema = z.union([
  z.object({ questionId: z.uuid(), option: optionKeySchema, note: textSchema.optional() }),
  z.object({ questionId: z.uuid(), note: textSchema }),
]);

export type Answer = z.infer<typeof answerSchema>;

/** The answer a question in argo's inbox has: the reply that carries it, when, and what it says. */
export const inboxAnswerSchema = z.object({
  messageId: idSchema('message'),
  sentAt: z.iso.datetime(),
  option: optionKeySchema.nullable(),
  note: z.string().nullable(),
});

/** A question in argo's inbox, with its answer; null while it is open. */
export const inboxQuestionSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  context: z.string(),
  options: z.array(optionSchema),
  pick: z.object({ option: optionKeySchema, why: z.string() }),
  answer: inboxAnswerSchema.nullable(),
});

export type InboxQuestion = z.infer<typeof inboxQuestionSchema>;

interface Carried {
  contentType: string;
  payload: string;
}

/** A payload as JSON; undefined when it is not JSON. */
function jsonOf(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

/** The question a message asks: a question's payload, or the new question a replacement carries; null for any other message. */
function questionOf({ contentType, payload }: Carried): Question | null {
  if (isQuestionContentType(contentType)) {
    const question = questionSchema.safeParse(jsonOf(payload));
    return question.success ? question.data : null;
  }
  if (isReplacementContentType(contentType)) {
    const replacement = replacementSchema.safeParse(jsonOf(payload));
    return replacement.success ? replacement.data.question : null;
  }
  return null;
}

/**
 * The question a message withdraws, and the new question when it replaces it;
 * null when the message is neither a withdrawal nor a replacement.
 */
export function withdrawalOf({ contentType, payload }: Carried): { questionId: string; replacement: Question | null } | null {
  if (isWithdrawalContentType(contentType)) {
    const withdrawal = withdrawalSchema.safeParse(jsonOf(payload));
    return withdrawal.success ? { questionId: withdrawal.data.questionId, replacement: null } : null;
  }
  if (isReplacementContentType(contentType)) {
    const replacement = replacementSchema.safeParse(jsonOf(payload));
    return replacement.success ? { questionId: replacement.data.questionId, replacement: replacement.data.question } : null;
  }
  return null;
}

/**
 * The question a message to argo asks (a question, or the new question of a
 * replacement), and its answer among argo's replies
 * to it (the first answer naming the question); null when the message asks
 * no question.
 */
export function inboxQuestionOf<T>({
  message,
  replies,
}: {
  message: Carried;
  replies: readonly (Carried & { id: MessageId; sentAt: T })[];
}): (Question & { answer: { messageId: MessageId; sentAt: T; option: number | null; note: string | null } | null }) | null {
  const question = questionOf(message);
  if (question === null) {
    return null;
  }
  for (const reply of replies) {
    const answer = isAnswerContentType(reply.contentType) ? answerSchema.safeParse(jsonOf(reply.payload)) : undefined;
    if (answer?.success === true && answer.data.questionId === question.id) {
      return {
        ...question,
        answer: {
          messageId: reply.id,
          sentAt: reply.sentAt,
          option: 'option' in answer.data ? answer.data.option : null,
          note: answer.data.note ?? null,
        },
      };
    }
  }
  return { ...question, answer: null };
}
