import { idSchema, type DeliveryId, type InboxFilter, type InboxMessage } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { OperatorInbox } from './operator-inbox';

const NOW = new Date('2026-09-28T14:40:00Z');

const shipId = (suffix: string) => idSchema('ship').parse(`shp_01j8xk4tqzr3a9w6m2v5n7${suffix}`);
const messageId = (suffix: string) => idSchema('message').parse(`msg_01j8zd2vqzr3a9w6m2v5n7${suffix}`);
const deliveryId = (suffix: string) => idSchema('delivery').parse(`dlv_01j8zd2vqzr3a9w6m2v5n7${suffix}`);

function aMessage(
  suffix: string,
  changes: { sender: string; senderSuffix: string; sentAt: string; payload: string; contentType?: string } & Partial<
    Pick<InboxMessage, 'state' | 'readAt' | 'doneAt' | 'repliedWith'>
  >,
): InboxMessage {
  const { sender, senderSuffix, sentAt, payload, contentType = 'text/plain', ...delivery } = changes;
  return {
    deliveryId: deliveryId(suffix),
    state: 'pending',
    readAt: null,
    doneAt: null,
    repliedWith: null,
    ...delivery,
    message: {
      id: messageId(suffix),
      sender: { id: shipId(senderSuffix), name: sender },
      inReplyTo: null,
      sentAt,
      contentType,
      payload,
    },
  };
}

const PROMOTE = aMessage('a001', {
  sender: 'release-captain',
  senderSuffix: '2vne',
  sentAt: '2026-09-28T14:30:00Z',
  readAt: '2026-09-28T14:35:00Z',
  payload:
    'Release 2.14 is staged on hetzner-2. All checks passed: unit, integration and e2e.\nPromote to production? Reply "go" to promote.',
});

const MIGRATION = aMessage('a002', {
  sender: 'builder-core',
  senderSuffix: '3k2p',
  sentAt: '2026-09-28T14:07:00Z',
  contentType: 'application/json',
  payload: '{"question":"Migration 0042 drops legacy_runs. Go ahead?","ref":"pr-321"}',
});

const FAILING = aMessage('a003', {
  sender: 'tester-01',
  senderSuffix: 'q8zr',
  sentAt: '2026-09-28T13:31:00Z',
  payload: 'checkout-e2e failed 3 of 5 runs since 12:00.',
});

const REVIEW_DONE = aMessage('a004', {
  sender: 'reviewer-01',
  senderSuffix: 'yb4c',
  sentAt: '2026-09-28T13:52:00Z',
  state: 'acknowledged',
  readAt: '2026-09-28T13:55:00Z',
  doneAt: '2026-09-28T13:58:00Z',
  repliedWith: messageId('b004'),
  payload: 'PR #318 review done: 2 blocking comments.\n\n1. Session keys are logged at debug level.\n2. The rotation job has no retry limit.',
});

const OPEN = [PROMOTE, MIGRATION, FAILING];
const COUNTS = { open: 3, done: 3, all: 6 };

/** A stateful inbox for the stories: the filter and the open message move as the operator clicks. */
function Inbox({
  messages,
  initialFilter = 'open',
  initialSelected,
  state = 'ready',
  pending = [],
}: {
  messages: readonly InboxMessage[];
  initialFilter?: InboxFilter;
  initialSelected?: DeliveryId;
  state?: 'loading' | 'error' | 'ready';
  pending?: readonly DeliveryId[];
}) {
  const [filter, setFilter] = useState<InboxFilter>(initialFilter);
  const [selectedId, setSelectedId] = useState<DeliveryId | undefined>(initialSelected);
  return (
    <OperatorInbox
      messages={messages}
      filter={filter}
      onFilterChange={setFilter}
      counts={COUNTS}
      selectedId={selectedId}
      onSelect={setSelectedId}
      state={state}
      onRetry={fn()}
      onMarkDone={fn()}
      onMarkUnread={fn()}
      onReply={fn()}
      pendingIds={new Set(pending)}
      now={NOW}
    />
  );
}

const meta = {
  title: 'Organisms/OperatorInbox',
  component: Inbox,
  args: { messages: OPEN, initialSelected: PROMOTE.deliveryId },
} satisfies Meta<typeof Inbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open filter, a read message open, two unread ones with the dot. */
export const DefaultOpen: Story = {};

export const DoneFilterDoneMessage: Story = {
  args: { messages: [REVIEW_DONE], initialFilter: 'done', initialSelected: REVIEW_DONE.deliveryId },
};

export const NothingSelected: Story = { args: { initialSelected: undefined } };

export const Empty: Story = { args: { messages: [], initialSelected: undefined } };

export const Loading: Story = { args: { state: 'loading' } };

export const LoadFailed: Story = { args: { state: 'error' } };

/** Mark done or a reply in flight for the open message. */
export const Pending: Story = { args: { pending: [PROMOTE.deliveryId] } };

export const PhoneList: Story = {
  args: { initialSelected: undefined },
  globals: { viewport: { value: 'mobile1' } },
};

/** A pushed page with the reply pinned to the bottom. */
export const PhoneMessage: Story = { globals: { viewport: { value: 'mobile1' } } };
