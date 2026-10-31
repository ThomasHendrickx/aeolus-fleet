import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { SegmentedControl } from './segmented-control';

const RANGES = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
] as const;

function StatefulControl({ value: initial }: { value: (typeof RANGES)[number]['value'] }) {
  const [value, setValue] = useState(initial);
  return <SegmentedControl label="Time range" options={RANGES} value={value} onChange={setValue} testId="range" />;
}

const meta = {
  title: 'Usage/SegmentedControl',
  component: StatefulControl,
  args: { value: '7d' },
} satisfies Meta<typeof StatefulControl>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens on the choice the URL names. */
export const Chosen: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('range-7d')).toHaveAttribute('aria-selected', 'true');
  },
};

/** A press moves the choice at once. */
export const ChoosingAnother: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('range-30d'));
    await expect(canvas.getByTestId('range-30d')).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByTestId('range-7d')).toHaveAttribute('aria-selected', 'false');
  },
};

export const ChosenDark: Story = { globals: { theme: 'dark' } };
