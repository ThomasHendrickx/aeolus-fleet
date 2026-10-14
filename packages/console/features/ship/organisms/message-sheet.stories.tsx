import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { MessageSheet } from './message-sheet';
import {
  DIRECT_MESSAGE,
  HANDED_NOT_CONFIRMED_MESSAGE,
  LEASE_ENDED_MESSAGE,
  MAC_MINI,
  NOT_HANDLED_MESSAGE,
  NOW,
  PENDING_BUSY_MESSAGE,
  PING_WAITING_MESSAGE,
  PUSHED_HANDLED_MESSAGE,
  RECEIVED_RESTARTING_MESSAGE,
  RETURNED_HISTORY,
  TYPE_MESSAGE,
  UNDELIVERABLE_HISTORY,
  UNKNOWN_MESSAGE_ID,
  minutesAgo,
} from '../../../lib/fixtures/ship-page.fixtures';

const meta = {
  title: 'Organisms/MessageSheet',
  component: MessageSheet,
  args: { message: TYPE_MESSAGE, state: 'ready', isOpen: true, onOpenChange: fn(), onOpenMessage: fn(), now: NOW },
} satisfies Meta<typeof MessageSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TypeAddressed: Story = {};
export const Direct: Story = { args: { message: DIRECT_MESSAGE } };
/** Reply answers the sender as argo, through Compose. */
export const WithReply: Story = { args: { message: DIRECT_MESSAGE, onReply: fn() } };
export const Undeliverable: Story = {
  args: {
    message: {
      ...DIRECT_MESSAGE,
      delivery: { ...DIRECT_MESSAGE.delivery, state: 'undeliverable', attempts: 5, history: UNDELIVERABLE_HISTORY },
    },
  },
};
/** A pushed message's happy path (2b): every step with its offset, handled, the reply beneath it. */
export const PushedHandled: Story = { args: { message: PUSHED_HANDLED_MESSAGE } };
export const PushedHandledDark: Story = { args: { message: PUSHED_HANDLED_MESSAGE }, globals: { theme: 'dark' } };
/** Received by the trierarch on mac-mini while its session restarts (3.5). */
export const ReceivedRestarting: Story = { args: { message: RECEIVED_RESTARTING_MESSAGE } };
/** The trierarch on mac-mini went silent while it holds the message (3.1, 3.10). */
export const TrierarchSilent: Story = {
  args: { message: RECEIVED_RESTARTING_MESSAGE, machines: [{ shipId: MAC_MINI.id, isSilent: true, lastSeenAt: minutesAgo(7) }] },
};
/** Pending while the session is busy, argo told at 60 min (3.4). */
export const PendingSessionBusy: Story = { args: { message: PENDING_BUSY_MESSAGE } };
export const PendingSessionBusyDark: Story = { args: { message: PENDING_BUSY_MESSAGE }, globals: { theme: 'dark' } };
/** Handed twice, never confirmed, argo told at 10 min (3.8, 3.9). */
export const HandedNotConfirmed: Story = { args: { message: HANDED_NOT_CONFIRMED_MESSAGE } };
export const HandedNotConfirmedDark: Story = { args: { message: HANDED_NOT_CONFIRMED_MESSAGE }, globals: { theme: 'dark' } };
/** Handed once more after its turn died, and not handled when it died again (3.7). */
export const NotHandled: Story = { args: { message: NOT_HANDLED_MESSAGE } };
export const NotHandledDark: Story = { args: { message: NOT_HANDLED_MESSAGE }, globals: { theme: 'dark' } };
/** Acknowledged, then its lease ended: handled unknown (3.11). */
export const HandledUnknown: Story = { args: { message: LEASE_ENDED_MESSAGE } };
/** Back to pending when its ship was released while it was handed (3.11). */
export const ReturnedAtRelease: Story = {
  args: {
    message: {
      ...PENDING_BUSY_MESSAGE,
      delivery: { ...PENDING_BUSY_MESSAGE.delivery, way: { ...PENDING_BUSY_MESSAGE.delivery.way, overdue: null, lease: null }, history: RETURNED_HISTORY },
    },
  },
};
/** A ping, handed, not answered yet (3.17). */
export const PingWaiting: Story = { args: { message: PING_WAITING_MESSAGE } };
export const Loading: Story = { args: { message: undefined, state: 'loading' } };
export const NotFound: Story = { args: { message: undefined, messageId: UNKNOWN_MESSAGE_ID, state: 'not-found' } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
export const PhonePushed: Story = { args: { message: HANDED_NOT_CONFIRMED_MESSAGE }, globals: { viewport: { value: 'mobile1' } } };
