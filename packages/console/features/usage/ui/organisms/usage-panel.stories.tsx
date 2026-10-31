import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { chartFixtureOf } from '../../services/usage.fixtures';
import { UsagePanel } from './usage-panel';

type Args = Parameters<typeof UsagePanel>[0];

/** Keeps the table open or closed the way the page keeps it in the URL. */
function StatefulPanel({ isTable: isTableAtFirst, ...props }: Args) {
  const [isTable, setIsTable] = useState(isTableAtFirst);
  return <UsagePanel {...props} isTable={isTable} onTableChange={setIsTable} />;
}

const READY = { kind: 'ready', ...chartFixtureOf('7d') } as const;

const meta = {
  title: 'Usage/UsagePanel',
  component: StatefulPanel,
  args: {
    view: READY,
    rangeWords: 'last 7 days',
    measure: 'tokens',
    splitBy: 'machine',
    format: { locale: 'en-GB', timeZone: 'Europe/Brussels', grain: 'hour' },
    isTable: false,
    onTableChange: () => undefined,
    silentMachines: [],
    onRetry: () => undefined,
    onClearFilters: () => undefined,
  },
} satisfies Meta<typeof StatefulPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Totals, one stacked chart, its legend and the notes. */
export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('usage-totals')).toBeInTheDocument();
    await expect(canvas.getByTestId('usage-legend')).toHaveTextContent('trierarch-mac');
    await expect(canvas.getByTestId('usage-notes')).toHaveTextContent('One column per hour, in your time zone.');
    await expect(canvas.queryByTestId('usage-partial')).toBeNull();
  },
};

/** Show as table opens the table, and Hide table closes it. */
export const ShowAsTable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('usage-table-toggle'));
    await expect(canvas.getByTestId('usage-table')).toBeInTheDocument();
    await expect(canvas.getByTestId('usage-table-toggle')).toHaveTextContent('Hide table');
  },
};

export const TableOpen: Story = { args: { isTable: true } };

/** Past 7 days the notes and the axis say days in UTC. */
export const ThirtyDaysInUtc: Story = {
  args: { view: { kind: 'ready', ...chartFixtureOf('30d') }, rangeWords: 'last 30 days', format: { locale: 'en-GB', grain: 'day' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('usage-notes')).toHaveTextContent('One column per day, days in UTC.');
    await expect(canvas.getByTestId('usage-axis-caption')).toHaveTextContent('days in UTC');
  },
};

/** On estimated cost the page says once that on a subscription the dollars are list prices. */
export const EstimatedCost: Story = {
  args: { view: { kind: 'ready', ...chartFixtureOf('7d', 'cost') }, measure: 'cost' },
  play: async ({ canvasElement }) => {
    const notes = await within(canvasElement).findByTestId('usage-notes');
    await expect(notes.textContent.match(/list-price/g)).toHaveLength(1);
  },
};

/** Machines the plugin lists that send no usage in the range are named under the chart. */
export const PartialUsage: Story = {
  args: { silentMachines: ['trierarch-macbook'] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('usage-partial')).toHaveTextContent('trierarch-macbook sends no usage in this range.');
  },
};

/** The shape of the card while usage is read. */
export const Loading: Story = {
  args: { view: { kind: 'loading' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('usage-loading')).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { view: { kind: 'empty', hasFilters: false } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('usage-empty')).toHaveTextContent('No usage in this range');
  },
};

/** Filters that hide everything offer the way back. */
export const EmptyWithFilters: Story = {
  args: { view: { kind: 'empty', hasFilters: true } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('usage-clear-filters')).toBeInTheDocument();
  },
};

export const CannotRead: Story = {
  args: { view: { kind: 'cannot-read' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('usage-cannot-read')).toHaveTextContent('Usage cannot be read now: the trierarch plugin does not answer');
  },
};

export const ReadyDark: Story = { globals: { theme: 'dark' } };
export const LoadingDark: Story = { args: { view: { kind: 'loading' } }, globals: { theme: 'dark' } };
