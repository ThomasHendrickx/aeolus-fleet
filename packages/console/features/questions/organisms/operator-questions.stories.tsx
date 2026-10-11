import { idSchema, type DeliveryId, type InboxQuestion } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import type { QuestionFilter, QuestionMessage } from '../../../lib/questions';
import { OperatorQuestions } from './operator-questions';

const NOW = new Date('2026-10-11T14:40:00Z');

const shipId = (suffix: string) => idSchema('ship').parse(`shp_01j8xk4tqzr3a9w6m2v5n7${suffix}`);
const messageId = (suffix: string) => idSchema('message').parse(`msg_01j8zd2vqzr3a9w6m2v5n7${suffix}`);
const deliveryId = (suffix: string) => idSchema('delivery').parse(`dlv_01j8zd2vqzr3a9w6m2v5n7${suffix}`);

function aQuestion(
  suffix: string,
  { sender, sentAt, question }: { sender: string; sentAt: string; question: Omit<InboxQuestion, 'answer'> & Partial<Pick<InboxQuestion, 'answer'>> },
): QuestionMessage {
  return {
    deliveryId: deliveryId(suffix),
    state: 'pending',
    readAt: null,
    doneAt: null,
    repliedWith: null,
    question: { answer: null, ...question },
    stale: null,
    replaces: null,
    message: {
      id: messageId(suffix),
      sender: { id: shipId(suffix), name: sender },
      inReplyTo: null,
      sentAt,
      contentType: 'application/vnd.aeolus.question+json',
      model: 'claude-opus-5-5',
      payload: JSON.stringify(question),
    },
  };
}

const PORT = aQuestion('a001', {
  sender: 'implementer-b',
  sentAt: '2026-10-11T14:30:00Z',
  question: {
    id: '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47',
    title: 'Which port does the console use in development?',
    context: 'docs/architecture.md says 3000 and the README says 4000. Core also listens on 3000 when both run.',
    options: [
      { key: 1, label: 'Keep 3000', detail: 'What the console uses now; core moves.' },
      { key: 2, label: 'Move to 4000', detail: 'Frees 3000 for core; the README is right.' },
      { key: 3, label: 'Make it configurable', detail: 'One more setting to document.' },
    ],
    pick: { option: 2, why: 'Fewest changes: only the console script and architecture.md.' },
  },
});

const MIGRATION = aQuestion('a002', {
  sender: 'builder-core',
  sentAt: '2026-10-11T13:07:00Z',
  question: {
    id: '0a7d3c1e-2b4f-4c6a-8e9d-1f3b5a7c9e2d',
    title: 'Drop legacy_runs in migration 0042?',
    context: '',
    options: [
      { key: 1, label: 'Drop it', detail: '' },
      { key: 2, label: 'Keep it one more release', detail: '' },
    ],
    pick: { option: 1, why: 'Nothing reads it since 0.19.' },
  },
});

const ANSWERED = {
  ...MIGRATION,
  state: 'acknowledged',
  doneAt: '2026-10-11T13:20:00Z',
  repliedWith: messageId('b002'),
  question: { ...MIGRATION.question, answer: { messageId: messageId('b002'), sentAt: '2026-10-11T13:20:00Z', option: 2, note: 'Squadrons still reads it.' } },
} satisfies QuestionMessage;

const PORT_AGAIN = {
  ...aQuestion('a003', {
    sender: 'implementer-b',
    sentAt: '2026-10-11T14:36:00Z',
    question: {
      ...PORT.question,
      id: '9b2e4d6f-1a3c-4e5b-8d7f-0c2a4e6b8d1f',
      title: 'Which port, now that core moved to 3100?',
      context: 'Core moved to 3100 this morning, so 3000 is free again.',
    },
  }),
  replaces: { deliveryId: PORT.deliveryId, title: PORT.question.title },
} satisfies QuestionMessage;

const REPLACED = {
  ...PORT,
  stale: { kind: 'replaced', deliveryId: PORT_AGAIN.deliveryId, sentAt: PORT_AGAIN.message.sentAt, by: { title: PORT_AGAIN.question.title } },
} satisfies QuestionMessage;

const WITHDRAWN = {
  ...MIGRATION,
  stale: { kind: 'withdrawn', deliveryId: deliveryId('c002'), sentAt: '2026-10-11T13:15:00Z' },
} satisfies QuestionMessage;

const COUNTS = { open: 2, answered: 1, stale: 2, all: 5 };

/** Stateful questions for the stories: the filter and the open question move as the operator clicks. */
function Questions({
  questions,
  initialFilter = 'open',
  initialSelected,
  state = 'ready',
  pending = [],
  isReadOnly = false,
}: {
  questions: readonly QuestionMessage[];
  initialFilter?: QuestionFilter;
  initialSelected?: DeliveryId;
  state?: 'loading' | 'error' | 'ready';
  pending?: readonly DeliveryId[];
  isReadOnly?: boolean;
}) {
  const [filter, setFilter] = useState<QuestionFilter>(initialFilter);
  const [selectedId, setSelectedId] = useState<DeliveryId | undefined>(initialSelected);
  return (
    <OperatorQuestions
      questions={questions}
      filter={filter}
      onFilterChange={setFilter}
      counts={COUNTS}
      selectedId={selectedId}
      onSelect={setSelectedId}
      state={state}
      onRetry={fn()}
      onAnswer={fn()}
      pendingIds={new Set(pending)}
      now={NOW}
      isReadOnly={isReadOnly}
    />
  );
}

const meta = {
  title: 'Organisms/OperatorQuestions',
  component: Questions,
  args: { questions: [PORT, MIGRATION], initialSelected: PORT.deliveryId },
} satisfies Meta<typeof Questions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open filter, a question open to answer: its options, the asker's pick and why. */
export const DefaultOpen: Story = {};

export const Answered: Story = {
  args: { questions: [ANSWERED], initialFilter: 'answered', initialSelected: ANSWERED.deliveryId },
};

/** Withdrawn by its asker: no answer form, and a notice that says so. */
export const Withdrawn: Story = {
  args: { questions: [REPLACED, WITHDRAWN], initialFilter: 'stale', initialSelected: WITHDRAWN.deliveryId },
};

/** Replaced by its asker: no answer form, and a link to the new question. */
export const Replaced: Story = {
  args: { questions: [PORT_AGAIN, REPLACED, WITHDRAWN], initialFilter: 'all', initialSelected: REPLACED.deliveryId },
};

/** The replacement: open to answer, linked to the question it replaces. */
export const Replacement: Story = {
  args: { questions: [PORT_AGAIN, MIGRATION], initialSelected: PORT_AGAIN.deliveryId },
};

export const NothingSelected: Story = { args: { initialSelected: undefined } };

export const Empty: Story = { args: { questions: [], initialSelected: undefined } };

export const Loading: Story = { args: { state: 'loading' } };

export const LoadFailed: Story = { args: { state: 'error' } };

/** The answer in flight. */
export const Pending: Story = { args: { pending: [PORT.deliveryId] } };

/** A viewer session: the question and its options, no answer form. */
export const ReadOnly: Story = { args: { isReadOnly: true } };
