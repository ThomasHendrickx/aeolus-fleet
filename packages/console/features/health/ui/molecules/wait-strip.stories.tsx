import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { WaitAxis, WaitStrip } from './wait-strip';

const meta = {
  title: 'Molecules/WaitStrip',
  component: WaitStrip,
  args: { waits: [33 * 60], label: '1 waiting, the oldest 1 d 9 h' },
  decorators: [(Story) => <div className="flex max-w-md flex-col gap-1">{Story()}<WaitAxis /></div>],
} satisfies Meta<typeof WaitStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One delivery waiting a day and a half. */
export const OneLong: Story = {};

/** Two fresh ones inside the shaded clocks, 40 and 39 minutes. */
export const InsideTheClocks: Story = { args: { waits: [40, 39], label: '2 waiting, the oldest 40 min' } };

/** Past 7 days and under a minute: clamped to the ends. */
export const BeyondTheScale: Story = { args: { waits: [30 * 24 * 60, 0.2], label: '2 waiting, the oldest 30 d' } };

export const Dark: Story = { globals: { theme: 'dark' } };
