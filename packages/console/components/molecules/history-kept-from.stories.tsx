import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { HistoryKeptFrom } from './history-kept-from';

const meta = {
  title: 'Molecules/HistoryKeptFrom',
  component: HistoryKeptFrom,
  args: { keptFrom: '2026-09-04T13:00:00.000Z', area: 'ship-timeline' },
} satisfies Meta<typeof HistoryKeptFrom>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pruned: Story = {};
export const NothingPruned: Story = { args: { keptFrom: null } };
