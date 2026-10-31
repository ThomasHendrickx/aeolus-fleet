import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { UsageTotalsBlock } from './usage-totals';

const meta = {
  title: 'Usage/UsageTotals',
  component: UsageTotalsBlock,
  args: { totals: { tokens: 1_234_567_890, estimatedCostUsd: 2_450, unpricedTokens: 0, unpricedModels: [] }, rangeWords: 'last 7 days' },
} satisfies Meta<typeof UsageTotalsBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every model is priced. */
export const Priced: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('usage-total-tokens')).toHaveTextContent('1.2 B');
    await expect(canvas.getByTestId('usage-total-cost')).toHaveTextContent('Every model priced');
  },
};

/** The tokens of a model no price covers count in tokens and nothing in the cost, and the totals name it. */
export const SomeNotPriced: Story = {
  args: { totals: { tokens: 18_000_000, estimatedCostUsd: 64.2, unpricedTokens: 1_800_000, unpricedModels: ['gpt-6-sol'] } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('usage-total-cost')).toHaveTextContent('1.8 M tokens not priced (gpt-6-sol)');
  },
};

export const PricedDark: Story = { globals: { theme: 'dark' } };
