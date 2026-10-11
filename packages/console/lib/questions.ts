'use client';

import type { AnswerChoice, DeliveryId, InboxMessage, InboxQuestion } from '@aeolus-fleet/common';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useConsoleRead } from './console-read-query';
import { fetchConsoleRead } from './fetch-console-read';
import { dataOf } from './plugin-answer';
import { answerQuestion } from './questions-actions';
import { useTRPC } from './trpc';

/**
 * Questions to argo as the browser reads them (decision 0038): the messages
 * in argo's inbox that the web app's server read as questions, through a
 * console read (lib/questions-reads.ts); answers go through a server function
 * (lib/questions-actions.ts). A question is open until argo answered it,
 * whatever its delivery's state; the inbox page leaves them out.
 */

/** A message to argo that asks a question, with its answer or none. */
export type QuestionMessage = Omit<InboxMessage, 'replies'> & { question: InboxQuestion };

/** The questions read's key, which a live inbox change reloads (lib/live-fleet.ts). */
export const QUESTIONS_KEY = ['questions'];

/** Open: not answered yet. Answered: argo sent its answer. All: both. */
export const QUESTION_FILTERS = ['open', 'answered', 'all'] as const;
export type QuestionFilter = (typeof QUESTION_FILTERS)[number];

/** The questions a filter keeps, in the server's order. */
export function questionsFor<T extends Pick<QuestionMessage, 'question'>>(questions: readonly T[], filter: QuestionFilter): T[] {
  switch (filter) {
    case 'open':
      return questions.filter((message) => message.question.answer === null);
    case 'answered':
      return questions.filter((message) => message.question.answer !== null);
    case 'all':
      return [...questions];
  }
}

/** The count beside each filter. */
export function questionFilterCounts(questions: readonly Pick<QuestionMessage, 'question'>[]): Record<QuestionFilter, number> {
  return {
    open: questionsFor(questions, 'open').length,
    answered: questionsFor(questions, 'answered').length,
    all: questions.length,
  };
}

/** The questions filter in the URL; Open unless it says otherwise. */
export function readQuestionFilter(value: string | undefined): QuestionFilter {
  return value === 'answered' || value === 'all' ? value : 'open';
}

/** The questions page's path for a filter and an open question. */
export function questionsPathOf(view: { filter: QuestionFilter; deliveryId?: DeliveryId }): string {
  const params = new URLSearchParams();
  if (view.filter !== 'open') {
    params.set('filter', view.filter);
  }
  if (view.deliveryId !== undefined) {
    params.set('question', view.deliveryId);
  }
  const query = params.toString();
  return query === '' ? '/questions' : `/questions?${query}`;
}

/** Every question to argo, newest first, as the web app's server read them. */
export function useQuestions() {
  return useConsoleRead({ queryKey: QUESTIONS_KEY, queryFn: () => fetchConsoleRead({ read: 'questions' }) });
}

/** The deliveries that carry questions, which the inbox leaves out; undefined until known. */
export function useQuestionDeliveryIds(): ReadonlySet<DeliveryId> | undefined {
  const questions = useQuestions().data;
  return questions === undefined ? undefined : new Set(questions.map(({ deliveryId }) => deliveryId));
}

/** How many questions to argo are open, for the navigation; undefined until known. */
export function useOpenQuestionCount(): number | undefined {
  const questions = useQuestions().data;
  return questions === undefined ? undefined : questionsFor(questions, 'open').length;
}

/** Answers a question to argo, which also marks its message done. */
export function useAnswer() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { deliveryId: DeliveryId; answer: AnswerChoice; idempotencyKey: string }) => dataOf(await answerQuestion(input)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUESTIONS_KEY }),
        queryClient.invalidateQueries({ queryKey: trpc.fleet.pathKey() }),
      ]);
    },
  });
}
