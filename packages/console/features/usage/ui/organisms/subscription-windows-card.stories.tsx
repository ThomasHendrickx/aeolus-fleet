import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { windowChartsFixtureOf } from '../../services/usage.fixtures';
import { SubscriptionWindowsCard } from './subscription-windows-card';

const meta = {
  title: 'Usage/SubscriptionWindowsCard',
  component: SubscriptionWindowsCard,
  args: {
    view: { kind: 'ready', charts: windowChartsFixtureOf('7d') },
    hasMore: false,
    isLoadingMore: false,
    isLoadMoreFailed: false,
    onLoadMore: () => undefined,
    onRetry: () => undefined,
    rangeStartWords: '21 Oct',
  },
} satisfies Meta<typeof SubscriptionWindowsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A chart per machine and harness, a line per window, the latest percent in each legend. */
export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('usage-windows-chart')).toHaveLength(3);
    await expect(canvas.getAllByRole('img', { name: /claude-code on trierarch-mac: 5 hours \d+% used, 7 days \d+% used/ })).toHaveLength(1);
  },
};

/** A page of 20 charts has more: Load more asks the next page by its cursor. */
export const MoreToLoad: Story = {
  args: { hasMore: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('usage-windows-load-more')).toBeInTheDocument();
  },
};

export const LoadingMore: Story = { args: { hasMore: true, isLoadingMore: true } };

export const LoadMoreFailed: Story = { args: { isLoadMoreFailed: true } };

/** The shape of the card while the windows are read. */
export const Loading: Story = {
  args: { view: { kind: 'loading' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('usage-windows-loading')).toBeInTheDocument();
  },
};

/** No harness said its windows in the range: they are left out, and the card says none. */
export const Empty: Story = {
  args: { view: { kind: 'empty' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('usage-windows-empty')).toHaveTextContent('No subscription windows in this range');
  },
};

export const CannotRead: Story = {
  args: { view: { kind: 'cannot-read' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('usage-windows-cannot-read')).toHaveTextContent('Subscription windows cannot be read now: the trierarch plugin does not answer');
  },
};

export const ReadyDark: Story = { globals: { theme: 'dark' } };
