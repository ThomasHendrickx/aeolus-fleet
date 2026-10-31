import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';

import { chartFixtureOf } from '../../services/usage.fixtures';
import { tokensWords, usdWords } from '../../services/usage-format';
import { UsageChart } from './usage-chart';

const FORMAT = { locale: 'en-GB', timeZone: 'Europe/Brussels' } as const;

const meta = {
  title: 'Usage/UsageChart',
  component: UsageChart,
  args: { chart: chartFixtureOf('7d').chart, format: { ...FORMAT, grain: 'hour' }, formatValue: tokensWords },
} satisfies Meta<typeof UsageChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 7 days: a column per hour, hours in the viewer's time zone. */
export const SevenDays: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('usage-column')).toHaveLength(168);
    await expect(canvas.getByTestId('usage-axis-caption')).toHaveTextContent('hours in your time zone');
  },
};

export const OneDay: Story = { args: { chart: chartFixtureOf('24h').chart } };

/** Past 7 days: a column per UTC day, the axis saying so. */
export const ThirtyDaysInUtc: Story = {
  args: { chart: chartFixtureOf('30d').chart, format: { ...FORMAT, grain: 'day' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('usage-column')).toHaveLength(30);
    await expect(canvas.getByTestId('usage-axis-caption')).toHaveTextContent('days in UTC');
  },
};

export const NinetyDaysInUtc: Story = { args: { chart: chartFixtureOf('90d').chart, format: { ...FORMAT, grain: 'day' } } };

/** Estimated cost draws the same columns in dollars. */
export const EstimatedCost: Story = { args: { chart: chartFixtureOf('7d', 'cost').chart, formatValue: usdWords } };

/** Hovering a column opens its tooltip: each series, the total and each token kind. */
export const HoveringAColumn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [first] = canvas.getAllByTestId('usage-column-hit');
    if (first !== undefined) {
      await userEvent.hover(first);
    }
    const tooltip = await canvas.findByTestId('usage-tooltip');
    await expect(tooltip).toHaveTextContent('trierarch-mac');
    await expect(within(tooltip).getByTestId('usage-tooltip-kinds')).toHaveTextContent('Input');
    await expect(within(tooltip).getByTestId('usage-tooltip-kinds')).toHaveTextContent('Cache write');
  },
};

export const SevenDaysDark: Story = { globals: { theme: 'dark' } };
