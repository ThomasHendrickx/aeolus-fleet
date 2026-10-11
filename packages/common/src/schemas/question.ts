import { z } from 'zod';

import { idSchema, type MessageId } from '../ids/index.js';

/**
 * Questions to argo (decision 0038): a ship asks the operator by sending a
 * message of the question content type to argo; the console answers it with a
 * reply of the answer content type. Both payloads are data only: the fleet
 * carries them as any message and never reads them; the console's server
 * does. A question is open until argo
 * sends its answer, whatever its delivery's state.
 */
export const QUESTION_CONTENT_TYPE = 'application/vnd.aeolus.question+json';
export const ANSWER_CONTENT_TYPE = 'application/vnd.aeolus.answer+json';

/** A content type's essence: media types compare without case and without their parameters (RFC 9110). */
function essenceOf(contentType: string): string {
  const [essence = ''] = contentType.split(';');
  return essence.trim().toLowerCase();
}

export function isQuestionContentType(contentType: string): boolean {
  return essenceOf(contentType) === QUESTION_CONTENT_TYPE;
}

export function isAnswerContentType(contentType: string): boolean {
  return essenceOf(contentType) === ANSWER_CONTENT_TYPE;
}

const FIRST_OPTION = 1;

/** An option's number, from 1. */
const optionKeySchema = z.int().min(FIRST_OPTION);

const textSchema = z.string().min(1);

const optionSchema = z.object({ key: optionKeySchema, label: textSchema, detail: z.string() });

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

/**
 * The question a message to argo asks, and its answer among argo's replies
 * to it (the first answer naming the question); null when the message is not
 * of the question type or its payload is no question.
 */
export function inboxQuestionOf<T>({
  message,
  replies,
}: {
  message: Carried;
  replies: readonly (Carried & { id: MessageId; sentAt: T })[];
}): (Question & { answer: { messageId: MessageId; sentAt: T; option: number | null; note: string | null } | null }) | null {
  if (!isQuestionContentType(message.contentType)) {
    return null;
  }
  const question = questionSchema.safeParse(jsonOf(message.payload));
  if (!question.success) {
    return null;
  }
  for (const reply of replies) {
    const answer = isAnswerContentType(reply.contentType) ? answerSchema.safeParse(jsonOf(reply.payload)) : undefined;
    if (answer?.success === true && answer.data.questionId === question.data.id) {
      return {
        ...question.data,
        answer: {
          messageId: reply.id,
          sentAt: reply.sentAt,
          option: 'option' in answer.data ? answer.data.option : null,
          note: answer.data.note ?? null,
        },
      };
    }
  }
  return { ...question.data, answer: null };
}
