import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { QUIET_HEALTH, STUCK_HEALTH } from '../../../../lib/fixtures/health.fixtures';
import { AcknowledgedBars } from './acknowledged-bars';

const meta = {
  title: 'Molecules/AcknowledgedBars',
  component: AcknowledgedBars,
  args: { perHour: STUCK_HEALTH.acknowledged.perHour },
} satisfies Meta<typeof AcknowledgedBars>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A day of deliveries, quiet at night. */
export const ADay: Story = {};

/** Nothing acknowledged: every bar at its floor. */
export const Nothing: Story = { args: { perHour: QUIET_HEALTH.acknowledged.perHour } };

export const Dark: Story = { globals: { theme: 'dark' } };
