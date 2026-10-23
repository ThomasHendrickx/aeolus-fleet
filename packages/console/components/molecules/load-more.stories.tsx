import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { LoadMore } from './load-more';

const meta = {
  title: 'Molecules/LoadMore',
  component: LoadMore,
  args: { what: 'older events', isLoading: false, isFailed: false, onLoad: fn(), area: 'ship-timeline' },
  decorators: [
    (Story) => (
      <div className="max-w-120 rounded-lg border border-border bg-card">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LoadMore>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Load older events' }));

    await expect(args.onLoad).toHaveBeenCalledOnce();
  },
};

export const Loading: Story = {
  args: { isLoading: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Loading older events...' })).toHaveAttribute('aria-busy', 'true');
  },
};

export const Failed: Story = {
  args: { isFailed: true },
  play: async ({ args, canvasElement }) => {
    await expect(within(canvasElement).getByText('Couldn’t load older events')).toBeVisible();
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Try again' }));

    await expect(args.onLoad).toHaveBeenCalledOnce();
  },
};
