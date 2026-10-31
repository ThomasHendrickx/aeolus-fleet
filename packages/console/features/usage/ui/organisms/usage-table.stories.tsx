import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';

import { chartFixtureOf } from '../../services/usage.fixtures';
import { tokensWords } from '../../services/usage-format';
import { UsageTable } from './usage-table';

const meta = {
  title: 'Usage/UsageTable',
  component: UsageTable,
  args: { chart: chartFixtureOf('7d').chart, format: { locale: 'en-GB', timeZone: 'Europe/Brussels', grain: 'hour' }, formatValue: tokensWords },
} satisfies Meta<typeof UsageTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Newest first, 24 rows, each token kind in full beside the series. */
export const SevenDays: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('usage-table-row')).toHaveLength(24);
    await expect(canvas.getAllByTestId('usage-table-input')[0]).toHaveTextContent(/^[\d,]+$/);
    await expect(canvas.getByRole('columnheader', { name: 'Cache write tokens' })).toBeInTheDocument();
  },
};

/** Load more shows 24 more rows. */
export const LoadingMoreRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('usage-table-load-more'));
    await expect(canvas.getAllByTestId('usage-table-row')).toHaveLength(48);
  },
};

export const ThirtyDays: Story = { args: { chart: chartFixtureOf('30d').chart, format: { locale: 'en-GB', grain: 'day' } } };

export const SevenDaysDark: Story = { globals: { theme: 'dark' } };
