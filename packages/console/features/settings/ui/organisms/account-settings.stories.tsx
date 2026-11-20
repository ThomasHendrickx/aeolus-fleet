import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { AccountSettings } from './account-settings';

const ACCOUNT_URL = 'https://account.acme.example/account';

const meta = {
  title: 'Organisms/AccountSettings',
  component: AccountSettings,
  args: { accountUrl: ACCOUNT_URL, onSignInAsArgo: fn(), isSigningInAsArgo: false },
} satisfies Meta<typeof AccountSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Settings, Your account (docs/design/app-navigation, where the account menu's items go): the account's own pages,
 * which open in Account, then Sign in as argo, last.
 */
export const Account: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Your account' })).toBeVisible();
    await expect(canvas.getByText('These pages open in Account.')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Your account' })).toHaveAttribute('href', ACCOUNT_URL);
    await expect(canvas.getByRole('link', { name: 'Your rights' })).toHaveAttribute('href', `${ACCOUNT_URL}/rights`);
    await expect(canvas.getByRole('link', { name: 'Email updates' })).toHaveAttribute('href', `${ACCOUNT_URL}/updates`);
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in as argo' }));
    await expect(args.onSignInAsArgo).toHaveBeenCalled();
  },
};
export const AccountPhone: Story = { ...Account, globals: { viewport: { value: 'mobile1' } } };

/** Signing in as argo: the row says so with a busy icon and waits. */
export const SigningInAsArgo: Story = {
  args: { isSigningInAsArgo: true },
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByRole('button', { name: 'Signing in as argo' });
    await expect(row).toBeDisabled();
    await expect(row.querySelector('[data-testid="settings-sign-in-as-argo-spinner"]')).not.toBeNull();
  },
};

/** An account not allowed as argo here: its pages alone. */
export const NotAllowedAsArgo: Story = {
  args: { onSignInAsArgo: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: 'Sign in as argo' })).toBeNull();
  },
};
