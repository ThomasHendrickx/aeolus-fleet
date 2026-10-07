import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { CrewRequestCell } from './crew-request-cell';

const meta = {
  title: 'Molecules/CrewRequestCell',
  component: CrewRequestCell,
} satisfies Meta<typeof CrewRequestCell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoRequest: Story = { args: { cell: undefined } };
export const NeedsCrew: Story = { args: { cell: { tone: 'waiting', word: 'Needs crew' } } };
export const Running: Story = { args: { cell: { tone: 'ok', word: 'Running' } } };
export const Crashed: Story = { args: { cell: { tone: 'attention', word: 'Crashed' } } };
