import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { NoMatch } from './no-match';

const meta = {
  title: 'Molecules/NoMatch',
  component: NoMatch,
  args: { query: 'zz', hasFilters: false, fleetShips: 19, onClear: fn() },
} satisfies Meta<typeof NoMatch>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A search alone matches nothing: what was asked, the fleet's size and Clear search. */
export const Search: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('fleet-no-match')).toHaveTextContent('No ships match “zz”.The fleet has 19 ships; none of them is in this view.');
    await userEvent.click(canvas.getByTestId('fleet-clear-filters'));
    await expect(args.onClear).toHaveBeenCalled();
  },
};

export const SearchDark: Story = { ...Search, globals: { theme: 'dark' } };

/** A search and filters: Clear search and filters. */
export const SearchAndFilters: Story = {
  args: { hasFilters: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('fleet-clear-filters')).toHaveTextContent('Clear search and filters');
  },
};

/** Filters alone: Clear filters. */
export const Filters: Story = {
  args: { query: '', hasFilters: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No ships match these filters.')).toBeVisible();
    await expect(canvas.getByTestId('fleet-clear-filters')).toHaveTextContent('Clear filters');
  },
};
