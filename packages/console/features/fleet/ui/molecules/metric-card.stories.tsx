import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CircleDashed, TriangleAlert, UserCheck } from 'lucide-react';

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

export const NeedsAttention: Story = {
  args: { label: 'Needs attention', shortLabel: undefined, value: 2, detail: 'Undeliverable deliveries, oldest 2 h 45 min', href: '/needs-attention', icon: TriangleAlert, tone: 'attention' },
};
