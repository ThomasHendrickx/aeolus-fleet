import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { HelpSettings } from './help-settings';

const meta = {
  title: 'Organisms/HelpSettings',
  component: HelpSettings,
  args: {
    shortcuts: [
      { keys: ['⌘', 'K'], label: 'Search ships or jump to' },
      { keys: ['⌘', '↵'], label: 'Send a message' },
    ],
    helpUrl: 'https://github.com/ThomasHendrickx/aeolus-fleet',
    onTakeTour: fn(),
  },
} satisfies Meta<typeof HelpSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Settings, Help (docs/design/app-navigation, where the account menu's items go): Keyboard shortcuts opens its dialog
 * with focus inside, and Escape returns focus to the row; Help opens the documentation in a new tab; Take the tour.
 */
export const Desktop: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Help' })).toBeVisible();
    const help = canvas.getByRole('link', { name: /^Help/ });
    await expect(help).toHaveAttribute('target', '_blank');
    await expect(help).toHaveAttribute('href', args.helpUrl);
    await expect(help).toHaveTextContent('Opens in a new tab');

    const shortcuts = canvas.getByRole('button', { name: 'Keyboard shortcuts' });
    await userEvent.click(shortcuts);
    const dialog = within(document.body).getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toHaveTextContent('Search ships or jump to');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(shortcuts).toHaveFocus());

    await userEvent.click(canvas.getByRole('button', { name: 'Take the tour' }));
    await expect(args.onTakeTour).toHaveBeenCalled();
  },
};

/** Phone has no keyboard shortcuts (H6). */
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'Keyboard shortcuts' })).toBeNull();
    await expect(canvas.getByRole('link', { name: /^Help/ })).toBeVisible();
  },
};

/** No guide set for the session: no Take the tour (0024). */
export const WithoutTour: Story = {
  args: { onTakeTour: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: 'Take the tour' })).toBeNull();
  },
};
