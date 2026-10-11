import type { DeliveryId, InboxMessage, InboxQuestion } from '@aeolus-fleet/common';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useInbox } from './inbox';
import { useTRPC } from './trpc';

/**
 * Questions to argo (decision 0038): the messages in argo's inbox the server
 * read as questions. A question is open until argo answered it, whatever its
 * delivery's state; the inbox page leaves them out.
 */

/** A message to argo that asks a question. */
export type QuestionMessage<T extends Pick<InboxMessage, 'question'> = InboxMessage> = T & { question: InboxQuestion };

/** Open: not answered yet. Answered: argo sent its answer. All: both. */
export const QUESTION_FILTERS = ['open', 'answered', 'all'] as const;
export type QuestionFilter = (typeof QUESTION_FILTERS)[number];

function isQuestion<T extends Pick<InboxMessage, 'question'>>(message: T): message is QuestionMessage<T> {
  return message.question !== null;
}

/** The questions among argo's messages, in the server's order. */
export function questionsOf<T extends Pick<InboxMessage, 'question'>>(messages: readonly T[]): QuestionMessage<T>[] {
  return messages.filter(isQuestion);
}

/** The questions a filter keeps, in the server's order. */
export function questionsFor<T extends Pick<InboxMessage, 'question'>>(messages: readonly T[], filter: QuestionFilter): QuestionMessage<T>[] {
  const questions = questionsOf(messages);
  switch (filter) {
    case 'open':
      return questions.filter((message) => message.question.answer === null);
    case 'answered':
      return questions.filter((message) => message.question.answer !== null);
    case 'all':
      return questions;
  }
}

/** The count beside each filter. */
export function questionFilterCounts(messages: readonly Pick<InboxMessage, 'question'>[]): Record<QuestionFilter, number> {
  return {
    open: questionsFor(messages, 'open').length,
    answered: questionsFor(messages, 'answered').length,
    all: questionsOf(messages).length,
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

/** How many questions to argo are open, for the navigation; undefined until known. */
export function useOpenQuestionCount(): number | undefined {
  const messages = useInbox().data;
  return messages === undefined ? undefined : questionsFor(messages, 'open').length;
}

/** Answers a question to argo, which also marks its message done. */
export function useAnswer() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    trpc.fleet.answer.mutationOptions({ onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.fleet.pathKey() }) }),
  );
}
