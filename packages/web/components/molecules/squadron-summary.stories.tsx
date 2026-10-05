import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { SquadronSummary } from './squadron-summary';

const meta = {
  title: 'Molecules/SquadronSummary',
  component: SquadronSummary,
  args: {
    health: [
      { health: 'on-time', count: 2 },
      { health: 'late', count: 1 },
      { health: 'silent', count: 1 },
    ],
    work: [
      { state: 'working', count: 1 },
      { state: 'idle', count: 2 },
      { state: 'blocked', count: 1 },
    ],
    openDeliveries: 3,
    keptCount: 0,
  },
} satisfies Meta<typeof SquadronSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sailing: Story = {};

/** Right after forming: nobody reports yet, the ships are still being read. */
export const JustFormed: Story = { args: { health: [{ health: 'not-on-station', count: 3 }], work: [], openDeliveries: undefined, keptCount: undefined } };

export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
