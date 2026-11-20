import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { THEMES } from '@aeolus-fleet/common';
import { expect, fn, userEvent, within } from 'storybook/test';

import { ThemeSettings } from './theme-settings';

const meta = {
  title: 'Organisms/ThemeSettings',
  component: ThemeSettings,
  args: { theme: 'light', themes: THEMES, hasThemeSwitch: true, onThemeChange: fn() },
} satisfies Meta<typeof ThemeSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Settings, Theme (docs/design/app-navigation, where the account menu's items go): the scope line and Light, Dark
 * and System, the one chosen pressed. A press applies the theme at once, keeps focus on its button and says so.
 */
export const Chosen: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Theme' })).toBeVisible();
    await expect(canvas.getByText('This browser, every Aeolus app')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(canvas.getByRole('button', { name: 'Dark' }));
    await expect(args.onThemeChange).toHaveBeenCalledWith('dark');
    await expect(canvas.getByRole('button', { name: 'Dark' })).toHaveFocus();
    await expect(canvas.getByRole('status')).toHaveTextContent('Theme: Dark');
  },
};
export const ChosenPhone: Story = { ...Chosen, globals: { viewport: { value: 'mobile1' } } };

/** Dark chosen, in the dark theme. */
export const Dark: Story = { args: { theme: 'dark' }, globals: { theme: 'dark' } };

/** The theme not read yet: its buttons wait. */
export const Unknown: Story = {
  args: { theme: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'System' })).toBeDisabled();
  },
};

/** A viewer sign-in shows this browser's theme and has no switch (0022). */
export const Viewer: Story = {
  args: { hasThemeSwitch: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('A viewer sign-in shows this browser’s theme and has no theme switch.')).toBeVisible();
    await expect(canvas.queryByRole('button')).toBeNull();
  },
};
