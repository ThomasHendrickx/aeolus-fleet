import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { TopBar } from './top-bar';

const meta = {
  title: 'Organisms/TopBar',
  component: TopBar,
  args: { title: 'reviewer-01', live: 'live', back: { href: '/inbox', label: 'Inbox' } },
  globals: { viewport: { value: 'mobile1' } },
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An open inbox conversation's own bar on phone: the back link and the live status, without the launcher. */
export const Detail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'Inbox' })).toHaveAttribute('href', '/inbox');
    await expect(canvas.queryByRole('button', { name: 'Apps and fleets' })).toBeNull();
  },
};
export const Offline: Story = { args: { live: 'offline' } };
