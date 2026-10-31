import { DELIVERY_STATES, SCHEDULE_STATES, SHIP_STATUSES } from '@aeolus-fleet/common';
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
/** A ship with an open alert, after its status on the overview (decision 0071). */
export const Alert: Story = { args: { status: 'alert' } };
export const Pending: Story = { args: { status: 'pending' } };
export const Handed: Story = { args: { status: 'handed' } };
export const Acknowledged: Story = { args: { status: 'acknowledged' } };
export const Handled: Story = { args: { status: 'handled' } };
export const NotHandled: Story = { args: { status: 'notHandled' } };
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
export const AtLimit: Story = { args: { status: 'at-limit' } };
export const OverLimit: Story = { args: { status: 'over-limit' } };
export const CrewStates: Story = {
  args: { status: 'needsCrew' },
  render: () => (
    <div className="flex flex-wrap gap-3">
      {(['needsCrew', 'crewedByHand', 'crewing', 'running', 'restarting', 'crashed', 'releasing'] as const).map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};

/** The fleet's health (decision 0042): the verdict, then each cause a delivery is stuck by. */
export const HealthStates: Story = {
  args: { status: 'stuck' },
  render: () => (
    <div className="flex flex-wrap gap-3">
      {(['stuck', 'delivering', 'noShipCanTake', 'waitingForCrew', 'stalledInFlight', 'undeliverable'] as const).map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};

/** A ship's schedule (decision 0062): it sends while active, and an ended or cancelled one never sends again. */
export const ScheduleStates: Story = {
  args: { status: 'active' },
  render: () => (
    <div className="flex flex-wrap gap-3">
      {SCHEDULE_STATES.map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};
/** A sealed fleet's state and its company key (decision 0068). */
export const Sealing: Story = {
  args: { status: 'sealing' },
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge status="sealing" />
      <StatusBadge status="sealed" />
      <StatusBadge status="reachable" />
      <StatusBadge status="notReachable" />
    </div>
  ),
};
