import { DELIVERY_STATES, SHIP_STATUSES } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { StatusBadge } from './status-badge';

const meta = {
  title: 'Molecules/StatusBadge',
  component: StatusBadge,
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AwaitingCrew: Story = { args: { status: 'awaitingCrew' } };
export const Crewed: Story = { args: { status: 'crewed' } };
export const Retired: Story = { args: { status: 'retired' } };
export const Pending: Story = { args: { status: 'pending' } };
export const InFlight: Story = { args: { status: 'delivered' } };
export const Acknowledged: Story = { args: { status: 'acknowledged' } };
export const Undeliverable: Story = { args: { status: 'undeliverable' } };
export const Dismissed: Story = { args: { status: 'dismissed' } };
export const Abandoned: Story = { args: { status: 'abandoned' } };

export const AllStates: Story = {
  args: { status: 'pending' },
  render: () => (
    <div className="flex flex-wrap gap-3">
      {[...SHIP_STATUSES, ...DELIVERY_STATES].map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};
export const Forming: Story = { args: { status: 'forming' } };
export const Sailing: Story = { args: { status: 'sailing' } };
export const StandingDown: Story = { args: { status: 'standing-down' } };
export const Disbanded: Story = { args: { status: 'disbanded' } };
