import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { DELIVERING_HEALTH, STUCK_HEALTH } from '../../../../lib/fixtures/health.fixtures';
import { marksOf } from '../../services/health-view';
import { StuckTrend } from './stuck-trend';

const meta = {
  title: 'Molecules/StuckTrend',
  component: StuckTrend,
  args: { perHour: STUCK_HEALTH.stuckPerHour, marks: marksOf(STUCK_HEALTH) },
  decorators: [(Story) => <div className="max-w-2xl">{Story()}</div>],
} satisfies Meta<typeof StuckTrend>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The week rising to 9, a numbered mark where each place began to wait. */
export const Rising: Story = {};

/** A short stall three days ago, nothing stuck now, no marks. */
export const Cleared: Story = { args: { perHour: DELIVERING_HEALTH.stuckPerHour, marks: [] } };

export const Dark: Story = { globals: { theme: 'dark' } };

export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
