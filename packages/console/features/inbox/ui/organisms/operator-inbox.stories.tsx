import type { DeliveryId, InboxFilter } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { ANSWERED, ENTRIES, MERGE_NOW, NOW, PR_READY, DISCARDED, THREAD, TIDE_TABLES, WITHDRAWN } from '../../../../lib/fixtures/inbox.fixtures';
import { isOpenEntry, type InboxEntry } from '../../../../lib/inbox-entry';
import { neighbourOf, questionPositionOf } from '../../services/inbox-moves';
import { inboxViewOf, openQuestionsOf, waitingOf } from '../../services/inbox-view';
import { OperatorInbox } from './operator-inbox';

/** A stateful inbox for the stories: the segment, the open row and the plugin group move as the operator clicks. */
function Inbox({
  entries,
  initialSegment = 'open',
  initialSelected,
  state = 'ready',
  pending = [],
  isReadOnly = false,
  isGroupExpanded = false,
}: {
  entries: readonly InboxEntry[];
  initialSegment?: InboxFilter;
  initialSelected?: DeliveryId;
  state?: 'loading' | 'error' | 'ready';
  pending?: readonly DeliveryId[];
  isReadOnly?: boolean;
  isGroupExpanded?: boolean;
}) {
  const [segment, setSegment] = useState<InboxFilter>(initialSegment);
  const [selectedId, setSelectedId] = useState<DeliveryId | undefined>(initialSelected);
  const [isExpanded, setIsExpanded] = useState(isGroupExpanded);
  // What core reads for the segment.
  const view = inboxViewOf(segment === 'all' ? entries : entries.filter((entry) => isOpenEntry(entry) === (segment === 'open')));
  const order = [...view.questions, ...view.messages, ...view.pluginMessages].map(({ deliveryId }) => deliveryId);
  const selected = entries.find(({ deliveryId }) => deliveryId === selectedId);
  const openIds = openQuestionsOf(entries).map(({ deliveryId }) => deliveryId);
  return (
    <OperatorInbox
      state={state}
      onRetry={fn()}
      view={view}
      segment={segment}
      onSegmentChange={setSegment}
      counts={{ open: entries.filter(isOpenEntry).length }}
      waiting={waitingOf(entries, NOW)}
      selected={selected}
      thread={selected?.kind === 'message' && selected.inReplyTo !== null ? THREAD : []}
      questionPosition={selected?.kind === 'question' ? questionPositionOf(openIds, selected.deliveryId) : undefined}
      order={order}
      onSelect={setSelectedId}
      onMove={(direction) => {
        setSelectedId(neighbourOf(order, { current: selectedId, direction }));
      }}
      isPluginGroupExpanded={isExpanded}
      onTogglePluginGroup={() => {
        setIsExpanded((wasExpanded) => !wasExpanded);
      }}
      onPluginGroupDone={fn()}
      onMarkDone={fn()}
      onMarkUnread={fn()}
      onReply={fn()}
      onAnswer={fn()}
      pendingIds={new Set(pending)}
      now={NOW}
      isReadOnly={isReadOnly}
    />
  );
}

const meta = {
  title: 'Organisms/OperatorInbox',
  component: Inbox,
  args: { entries: ENTRIES, initialSelected: TIDE_TABLES.deliveryId },
} satisfies Meta<typeof Inbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Questions on top, oldest first, the first open with the asker's pick chosen and the Answer button naming it. */
export const OpenQuestion: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('inbox-answer')[0]).toHaveTextContent('Answer: 14 days');
  },
};

/** Choosing another option and writing a note changes what the button says it sends. */
export const AnswerWithNote: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [desktop] = canvas.getAllByTestId('inbox-question');
    if (desktop === undefined) {
      throw new Error('no question');
    }
    const pane = within(desktop);
    await userEvent.click(pane.getByText('30 days'));
    await userEvent.type(pane.getByTestId('inbox-note'), 'Make it a setting.');
    await expect(pane.getByTestId('inbox-answer')).toHaveTextContent('Answer: 30 days, with note');
  },
};

/** A second tap on the chosen option takes it back: a note goes alone. */
export const NoteAlone: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [desktop] = canvas.getAllByTestId('inbox-question');
    if (desktop === undefined) {
      throw new Error('no question');
    }
    const pane = within(desktop);
    await userEvent.click(pane.getByText('14 days'));
    await userEvent.type(pane.getByTestId('inbox-note'), 'More context, please.');
    await expect(pane.getByTestId('inbox-answer')).toHaveTextContent('Send note');
  },
};

/** After the answer: what was sent, and Next question. */
export const Answered: Story = {
  args: { entries: [ANSWERED, MERGE_NOW, PR_READY], initialSelected: ANSWERED.deliveryId },
};

export const Stale: Story = { args: { initialSegment: 'done', initialSelected: WITHDRAWN.deliveryId } };

/** A message with its body rendered, the pull request it links to and its thread. */
export const OpenMessage: Story = { args: { initialSelected: PR_READY.deliveryId } };

/** A plugin ship's long message, folded behind Show all. */
export const PluginMessage: Story = { args: { initialSelected: DISCARDED.deliveryId, isGroupExpanded: true } };

export const PluginGroupUnfolded: Story = { args: { initialSelected: undefined, isGroupExpanded: true } };

export const NothingOpen: Story = { args: { initialSelected: undefined } };

export const Done: Story = { args: { initialSegment: 'done', initialSelected: undefined } };

/** Nothing waits. */
export const Empty: Story = { args: { entries: [ANSWERED], initialSelected: undefined } };

export const Loading: Story = { args: { state: 'loading' } };

export const LoadFailed: Story = { args: { state: 'error' } };

/** An answer in flight. */
export const Pending: Story = { args: { pending: [TIDE_TABLES.deliveryId] } };

/** A viewer session (decision 0022): everything shown, nothing that changes it. */
export const ReadOnly: Story = { args: { isReadOnly: true } };

export const PhoneList: Story = {
  args: { initialSelected: undefined },
  globals: { viewport: { value: 'mobile1' } },
};

/** A question as a page of its own, Add a note and Answer in the bar at the bottom. */
export const PhoneQuestion: Story = { globals: { viewport: { value: 'mobile1' } } };

export const PhoneAnswered: Story = {
  args: { entries: [ANSWERED, MERGE_NOW, PR_READY], initialSelected: ANSWERED.deliveryId },
  globals: { viewport: { value: 'mobile1' } },
};

/** A message as a page of its own, the reply field and Done in the bar at the bottom. */
export const PhoneMessage: Story = { args: { initialSelected: PR_READY.deliveryId }, globals: { viewport: { value: 'mobile1' } } };

export const PhoneEmpty: Story = { args: { entries: [], initialSelected: undefined }, globals: { viewport: { value: 'mobile1' } } };
