'use client';

import type { DeliveryId } from '@aeolus-fleet/common';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { showToast } from '../../../components/atoms/toast';
import { ListPage } from '../../../components/organisms/list-page';
import { OperatorQuestions } from '../../../features/questions/organisms/operator-questions';
import { useAccess } from '../../../lib/access';
import { useConsoleFrame } from '../../../lib/console-frame';
import { useLiveFleet } from '../../../lib/live-fleet';
import { useNow } from '../../../lib/now';
import { questionFilterCounts, questionsFor, questionsPathOf, readQuestionFilter, useAnswer, useQuestions, type QuestionFilter } from '../../../lib/questions';
import { useSignInWhenSessionEnds } from '../../../lib/session';

/** The refusal's words, safe to show: the server's message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Try again in a moment.';
}

/**
 * Questions ships asked argo, live: Open, Answered or All. Answering sends
 * the answer as a reply to the asking ship. The filter and the open question
 * live in the URL, read on the web app's server (page.tsx).
 */
export function QuestionsPageFor({ filterParameter, selectedId }: { filterParameter?: string; selectedId?: DeliveryId }) {
  const router = useRouter();
  const now = useNow();
  const filter = readQuestionFilter(filterParameter);

  const questions = useQuestions();
  const answer = useAnswer();
  const liveFleet = useLiveFleet();
  const frame = useConsoleFrame();
  useSignInWhenSessionEnds([liveFleet.error]);
  const access = useAccess();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<DeliveryId>>(new Set());

  const all = questions.data ?? [];
  const show = (view: { filter: QuestionFilter; deliveryId?: DeliveryId }) => {
    router.replace(questionsPathOf(view), { scroll: false });
  };

  return (
    <ListPage
      {...frame}
      title="Questions"
      description="Questions ships asked argo, with their options and the asker’s pick. Answering sends your answer back as a reply."
      live={liveFleet.live}
    >
      <OperatorQuestions
        isReadOnly={!access.canReceive}
        questions={questionsFor(all, filter)}
        filter={filter}
        onFilterChange={(next) => {
          show({ filter: next });
        }}
        counts={questions.data ? questionFilterCounts(all) : {}}
        selectedId={selectedId}
        onSelect={(deliveryId) => {
          show({ filter, ...(deliveryId === undefined ? {} : { deliveryId }) });
        }}
        state={questions.isError ? 'error' : questions.data ? 'ready' : 'loading'}
        onRetry={() => {
          void questions.refetch();
        }}
        onAnswer={({ deliveryId, answer: choice }) => {
          setPendingIds((pending) => new Set([...pending, deliveryId]));
          answer
            .mutateAsync({ deliveryId, answer: choice, idempotencyKey: `answer-${deliveryId}-${crypto.randomUUID()}` })
            .catch((error: unknown) => {
              showToast({ title: "Couldn’t send the answer", description: messageOf(error), tone: 'error' });
            })
            .finally(() => {
              setPendingIds((pending) => new Set([...pending].filter((id) => id !== deliveryId)));
            });
        }}
        pendingIds={pendingIds}
        now={now}
      />
    </ListPage>
  );
}
