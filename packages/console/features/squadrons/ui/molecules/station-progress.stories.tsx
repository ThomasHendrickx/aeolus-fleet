import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { StationProgress } from './station-progress';

const meta = {
  title: 'Molecules/StationProgress',
  component: StationProgress,
} satisfies Meta<typeof StationProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoneYet: Story = {
  args: { done: 0, total: 4, variant: 'forming' },
};
export const Halfway: Story = {
  args: { done: 2, total: 4, variant: 'forming' },
};
export const AllOnStation: Story = {
  args: { done: 4, total: 4, variant: 'forming' },
};
