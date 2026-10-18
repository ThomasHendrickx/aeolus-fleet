import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { DeliveryHistory } from './delivery-history';
import {
  DIRECT_HISTORY,
  HANDED_NOT_CONFIRMED_MESSAGE,
  NOT_HANDLED_MESSAGE,
  PUSHED_HANDLED_HISTORY,
  RECEIVED_RESTARTING_MESSAGE,
  RETURNED_HISTORY,
  REVIEWER,
  TYPE_HISTORY,
  UNDELIVERABLE_HISTORY,
} from '../../../../lib/fixtures/ship-page.fixtures';

const meta = {
  title: 'Organisms/DeliveryHistory',
  component: DeliveryHistory,
  args: { entries: DIRECT_HISTORY, recipient: { kind: 'ship', ship: REVIEWER } },
  decorators: [
    (Story) => (
      <div className="max-w-120 rounded-lg border border-border bg-card p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DeliveryHistory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Direct: Story = {};
export const TypeAddressed: Story = { args: { entries: TYPE_HISTORY, recipient: { kind: 'type', type: 'reviewer' } } };
export const Undeliverable: Story = { args: { entries: UNDELIVERABLE_HISTORY } };
export const JustStored: Story = { args: { entries: DIRECT_HISTORY.slice(-1) } };
/** Pushed, every step with its offset from the store: received, handed (no. 1), acknowledged, handled (2b). */
export const Pushed: Story = { args: { entries: PUSHED_HANDLED_HISTORY } };
export const PushedDark: Story = { args: { entries: PUSHED_HANDLED_HISTORY }, globals: { theme: 'dark' } };
/** Received again after a restart of the trierarch (3.2). */
export const ReceivedAgain: Story = { args: { entries: RECEIVED_RESTARTING_MESSAGE.delivery.history } };
/** Handed again with a new number, then argo told at 10 min (3.8, 3.9). */
export const Overdue: Story = { args: { entries: HANDED_NOT_CONFIRMED_MESSAGE.delivery.history } };
export const OverdueDark: Story = { args: { entries: HANDED_NOT_CONFIRMED_MESSAGE.delivery.history }, globals: { theme: 'dark' } };
/** Handed once more, then not handled (3.7). */
export const NotHandled: Story = { args: { entries: NOT_HANDLED_MESSAGE.delivery.history } };
/** Back in the inbox at the ship's release, which ended its hand-over (3.11). */
export const ReturnedAtRelease: Story = { args: { entries: RETURNED_HISTORY } };
