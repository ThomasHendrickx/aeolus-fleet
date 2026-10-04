import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { LimitMeter } from './limit-meter';

const RESETS = '2026-10-05T00:00:00.000Z';

const meta = {
  title: 'Molecules/LimitMeter',
  component: LimitMeter,
  args: { kind: 'ships', count: 7, limit: 10 },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LimitMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Below the limit: neutral, with what is left. */
export const Below: Story = {};
/** At the limit: the waiting tone and At limit. */
export const AtLimit: Story = { args: { count: 10 } };
/** Over the limit, a limit lowered below use: the attention tone and Over limit. */
export const OverLimit: Story = { args: { count: 12 } };
/** No limit set: the count with No limit, never a blank or a zero. */
export const NoLimit: Story = { args: { count: 5, limit: null } };
/** Messages today, with when the count resets. */
export const MessagesToday: Story = { args: { kind: 'messages', count: 412, limit: 1000, resetsAt: RESETS } };
/** Messages today at the daily limit. */
export const MessagesAtLimit: Story = { args: { kind: 'messages', count: 1000, limit: 1000, resetsAt: RESETS } };
