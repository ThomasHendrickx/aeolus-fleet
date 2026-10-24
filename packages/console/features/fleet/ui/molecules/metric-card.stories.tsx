import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CircleDashed, OctagonAlert, UserCheck } from 'lucide-react';

import { MetricCard } from './metric-card';

const meta = {
  title: 'Molecules/MetricCard',
  component: MetricCard,
  args: {
    label: 'Ships crewed',
    shortLabel: 'Crewed',
    value: 7,
    detail: 'of 9 active ships',
    href: '/?status=crewed',
    icon: UserCheck,
    tone: 'ok',
  },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MetricCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Crewed: Story = {};

/** The ship that has awaited crew longest, by name. */
export const AwaitingCrew: Story = {
  args: { label: 'Awaiting crew', shortLabel: undefined, value: 2, detail: 'Longest wait: reviewer-1, 2 min', href: '/?status=awaitingCrew', icon: CircleDashed, tone: 'waiting' },
};

export const Stuck: Story = {
  args: { label: 'Stuck', shortLabel: undefined, value: 9, detail: 'Deliveries stuck, oldest 1 d 19 h', href: '/fleet-health', icon: OctagonAlert, tone: 'attention' },
};

/** While its count is read: the number and the line as skeletons, the label and the link already there. */
export const Loading: Story = {
  args: { label: 'Stuck', shortLabel: undefined, value: undefined, detail: undefined, href: '/fleet-health', icon: OctagonAlert, tone: 'attention' },
};
