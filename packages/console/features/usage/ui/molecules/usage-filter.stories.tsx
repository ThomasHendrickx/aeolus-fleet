import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { UsageFilter } from './usage-filter';

const MACHINES = [
  { key: 'shp_mac', word: 'trierarch-mac', tokens: 4_100_000 },
  { key: 'shp_linux', word: 'trierarch-linux-1', tokens: 2_300_000 },
  { key: 'shp_macbook', word: 'trierarch-macbook', tokens: 12_000 },
];

type Args = Parameters<typeof UsageFilter>[0];

/** Keeps what is picked the way the page keeps it in the URL. */
function StatefulFilter({ picked: initial, ...props }: Args) {
  const [picked, setPicked] = useState(initial);
  return <UsageFilter {...props} picked={picked} onPickedChange={setPicked} />;
}

const meta = {
  title: 'Usage/UsageFilter',
  component: StatefulFilter,
  args: { label: 'Machine', items: MACHINES, picked: [], onPickedChange: () => undefined, testId: 'filter' },
} satisfies Meta<typeof StatefulFilter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing picked: no filter, the trigger reads All. */
export const NothingPicked: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('filter')).toHaveTextContent('MachineAll');
  },
};

/** One value picked, as a link from a machine card opens it: the trigger names it. */
export const OnePicked: Story = {
  args: { picked: ['shp_mac'] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('filter')).toHaveTextContent('Machinetrierarch-mac');
  },
};

export const SeveralPicked: Story = {
  args: { picked: ['shp_mac', 'shp_linux'] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('filter')).toHaveTextContent('Machine2 picked');
  },
};

/** The menu lists each value with its tokens, and picking one names it in the trigger. */
export const PickingAValue: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('filter'));
    const option = await within(document.body).findByRole('option', { name: /trierarch-linux-1/ });
    await expect(option).toHaveTextContent('2.3 M');
    await userEvent.click(option);
    await expect(within(canvasElement).getByTestId('filter')).toHaveTextContent('Machinetrierarch-linux-1');
  },
};

/** The first page is on its way. */
export const Loading: Story = { args: { items: undefined } };

export const LoadFailed: Story = { args: { items: undefined, isFailed: true } };

/** More values than a page: Load more at the end of the menu. */
export const MoreToLoad: Story = {
  args: { hasMore: true },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('filter'));
    await expect(await within(document.body).findByTestId('filter-load-more')).toBeInTheDocument();
  },
};

export const LoadingMore: Story = { args: { hasMore: true, isLoadingMore: true } };

export const SeveralPickedDark: Story = { ...SeveralPicked, globals: { theme: 'dark' } };
