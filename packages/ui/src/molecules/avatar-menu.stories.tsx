import type { Meta, StoryObj } from '@storybook/react-vite';
import { Compass } from 'lucide-react';
import { expect, fn, screen, userEvent, within } from 'storybook/test';

import { AvatarMenu, AvatarMenuSheet } from './avatar-menu.js';

const meta = {
  title: 'Header/AvatarMenu',
  component: AvatarMenu,
  args: {
    name: 'charlotte@acme.example',
    signedInAs: 'account',
    session: 'Device · Mac · Chrome, since 08:02',
    accountUrl: 'https://account.example/account',
    theme: 'system',
    themes: ['light', 'dark', 'system'],
    hasTheme: true,
    onThemeChange: fn(),
    shortcuts: [
      { keys: ['⌘', 'K'], label: 'Search or jump to' },
      { keys: ['⌘', '↵'], label: 'Send' },
    ],
    helpUrl: 'https://github.com/ThomasHendrickx/aeolus-fleet#readme',
    onSignOut: fn(),
    isSigningOut: false,
    entries: [{ key: 'take-tour', label: 'Take the tour', icon: <Compass aria-hidden />, onSelect: fn() }],
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-160 justify-end p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AvatarMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

/** Signed in as your account: who and how, the account's own pages, the theme, shortcuts, help and sign out (H10). */
export const SignedInAsYourAccount: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('avatar-menu'));
    await expect(await screen.findByTestId('avatar-menu-signed-in-as')).toHaveTextContent('Signed in as your account');
    await expect(screen.getByTestId('avatar-menu-rights')).toHaveAttribute('href', 'https://account.example/account/rights');
    await expect(screen.getByTestId('avatar-menu-updates')).toHaveAttribute('href', 'https://account.example/account/updates');
  },
};

/** An entry whose work runs on the server, as Sign in as argo's does: the menu stays open, and the entry says it is working, with a spinner, and takes no second press. */
export const EntryWorking: Story = {
  args: {
    entries: [{ key: 'sign-in-as-argo', label: 'Sign in as argo', workingLabel: 'Signing in as argo', isWorking: true, icon: <Compass aria-hidden />, onSelect: fn() }],
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('avatar-menu'));
    const entry = await screen.findByTestId('avatar-menu-sign-in-as-argo');
    await expect(entry).toHaveTextContent('Signing in as argo');
    await expect(entry).toHaveAttribute('aria-disabled', 'true');
    await expect(within(entry).getByTestId('avatar-menu-entry-spinner')).toBeInTheDocument();
  },
};

/** Signed in as argo, with no account: no account pages (H8). */
export const SignedInAsArgo: Story = {
  args: { name: undefined, signedInAs: 'argo', accountUrl: undefined },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('avatar-menu'));
    await expect(await screen.findByTestId('avatar-menu-signed-in-as')).toHaveTextContent('Signed in as argo');
    await expect(screen.queryByTestId('avatar-menu-account')).toBeNull();
  },
};

/** The viewer: no theme, no account pages (H8). */
export const Viewer: Story = {
  args: { name: undefined, signedInAs: 'viewer', accountUrl: undefined, theme: undefined, hasTheme: false },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('avatar-menu'));
    await expect(await screen.findByTestId('avatar-menu-signed-in-as')).toHaveTextContent('Viewer');
    await expect(screen.queryByTestId('avatar-menu-theme-dark')).toBeNull();
  },
};

/** A theme is handed over at once; the app applies it. */
export const ThemeChange: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('avatar-menu'));
    await userEvent.click(await screen.findByTestId('avatar-menu-theme-dark'));
    await expect(args.onThemeChange).toHaveBeenCalledWith('dark');
  },
};

/** Keyboard shortcuts open their dialog. */
export const Shortcuts: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('avatar-menu'));
    await userEvent.click(await screen.findByTestId('avatar-menu-shortcuts'));
    await expect(await screen.findByTestId('avatar-menu-shortcuts-dialog')).toHaveTextContent('Search or jump to');
  },
};

/** Signing out: "Signing out" with a spinner, and it cannot run twice. */
export const SigningOut: Story = {
  args: { isSigningOut: true },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('avatar-menu'));
    const signOut = await screen.findByTestId('avatar-menu-sign-out');
    await expect(signOut).toHaveTextContent('Signing out');
    await expect(signOut).toHaveAttribute('data-disabled');
  },
};

/** Sign out is handed over at a press; the app shows it pending (SigningOut). */
export const SignOut: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('avatar-menu'));
    await userEvent.click(await screen.findByTestId('avatar-menu-sign-out'));
    await expect(args.onSignOut).toHaveBeenCalled();
  },
};

/** Phone: the same content as a bottom Sheet, the theme as three buttons, no shortcuts (H6). */
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  render: (args) => <AvatarMenuSheet {...args} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('avatar-menu'));
    const sheet = await screen.findByTestId('avatar-menu-sheet');
    await expect(within(sheet).getByTestId('avatar-menu-theme-system')).toHaveAttribute('aria-pressed', 'true');
    await expect(within(sheet).queryByTestId('avatar-menu-shortcuts')).toBeNull();
  },
};

/** Phone, signing out: "Signing out", disabled. */
export const PhoneSigningOut: Story = {
  args: { isSigningOut: true },
  globals: { viewport: { value: 'mobile1' } },
  render: (args) => <AvatarMenuSheet {...args} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('avatar-menu'));
    const signOut = within(await screen.findByTestId('avatar-menu-sheet')).getByTestId('avatar-menu-sign-out');
    await expect(signOut).toHaveTextContent('Signing out');
    await expect(signOut).toBeDisabled();
  },
};
