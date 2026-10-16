import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, within } from 'storybook/test';

import { FilterSelect } from './filter-select';

const KIND_WORDS = { claudeCode: 'Claude Code', codex: 'Codex', trierarch: 'Trierarch' };

/** Keeps what is picked the way the overview keeps it in the URL. */
function StatefulFilterSelect({ picked: initial, size }: { picked: readonly string[]; size?: 'sm' | 'touch' }) {
  const [picked, setPicked] = useState(initial);
  return <FilterSelect label="Kind" items={KIND_WORDS} picked={picked} onPickedChange={setPicked} size={size} testId="filter-select" />;
}

const meta = {
  title: 'Molecules/FilterSelect',
  component: StatefulFilterSelect,
  args: { picked: [] },
} satisfies Meta<typeof StatefulFilterSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing picked: no filter, the trigger reads All. */
export const NothingPicked: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('filter-select')).toHaveTextContent('KindAll');
  },
};

/** One value picked: the trigger names it. */
export const OnePicked: Story = {
  args: { picked: ['codex'] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('filter-select')).toHaveTextContent('KindCodex');
  },
};

/** Several values picked: the trigger counts them. */
export const SeveralPicked: Story = {
  args: { picked: ['claudeCode', 'codex'] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('filter-select')).toHaveTextContent('Kind2 picked');
  },
};

export const SeveralPickedDark: Story = { ...SeveralPicked, globals: { theme: 'dark' } };

export const SeveralPickedTouch: Story = { args: { picked: ['claudeCode', 'codex'], size: 'touch' } };
