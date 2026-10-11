'use server';

import { answerChoiceSchema, idSchema, replyOutputSchema } from '@aeolus-fleet/common';
import { headers } from 'next/headers';
import { z } from 'zod';

import type { PluginAnswer } from './plugin-answer';
import { answerReplyOf } from './question-answer';
import { callFleet, readArgoInbox } from './questions-reads';

/**
 * Answering a question to argo as the browser reaches it (decisions 0033,
 * 0038): a server function that reads the question from argo's inbox, checks
 * the answer against it, and sends it through the fleet's Reply with the
 * answer content type, which also marks the message done.
 */

const answerInputSchema = z.object({
  deliveryId: idSchema('delivery'),
  answer: answerChoiceSchema,
  idempotencyKey: z.string().min(1),
});

export async function answerQuestion(input: unknown): Promise<PluginAnswer<{ messageId: string }>> {
  const parsed = answerInputSchema.safeParse(input);
  if (!parsed.success) {
    return { kind: 'refused', message: 'Pick an option or write a note' };
  }
  const origin = (await headers()).get('origin');
  if (origin === null) {
    return { kind: 'refused', message: 'Answer from the console' };
  }
  const inbox = await readArgoInbox();
  if (inbox.kind === 'refused') {
    return inbox;
  }
  const entry = inbox.data.find(({ deliveryId }) => deliveryId === parsed.data.deliveryId);
  if (entry === undefined) {
    return { kind: 'refused', message: 'That question is not in your inbox' };
  }
  const reply = answerReplyOf(entry, parsed.data.answer);
  if (reply.kind === 'refused') {
    return reply;
  }
  return callFleet('fleet.reply', {
    input: { deliveryId: entry.deliveryId, ...reply.data, idempotencyKey: parsed.data.idempotencyKey },
    isMutation: true,
    origin,
    answers: replyOutputSchema,
  });
}
