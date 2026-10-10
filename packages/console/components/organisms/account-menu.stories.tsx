import { THEMES } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn, userEvent, within } from 'storybook/test';

import { AccountMenu, AccountMenuSheet, type AccountMenuAccount } from './account-menu';

const NOW = new Date('2026-10-01T14:30:00');

const ACCOUNT: Extract<AccountMenuAccount, { kind: 'operator' }> = {
  kind: 'operator',
  email: 'operator@example.com',
  session: { device: 'Mac · Chrome', since: new Date('2026-10-01T08:02:00').toISOString() },
  theme: 'system',
};

const meta = {
  title: 'Organisms/AccountMenu',
  component: AccountMenu,
  args: { account: ACCOUNT, themes: THEMES, onThemeChange: fn(), onSignOut: fn(), isSigningOut: false, now: NOW },
  decorators: [
    (Story) => (
      <div className="flex min-h-120 w-64 flex-col justify-end border-r border-border bg-sidebar p-2.5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AccountMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Closed: the account button at the foot of the Sidebar. */
export const Closed: Story = {};

/** Open upwards: who, this session, Theme with the current one checked, Sign out. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('account-menu'));
  },
};

/** Opened from the keyboard: Enter on the focused button, the first item highlighted. */
export const KeyboardFocus: Story = {
  play: async () => {
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
  },
};

/** Signing out: the row shows a spinner and waits. */
export const SigningOut: Story = {
  args: { isSigningOut: true },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('account-menu'));
  },
};

/** The account is not known yet: the button shows, the session line and the theme wait. */
export const Loading: Story = {
  args: { account: undefined },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('account-menu'));
  },
};

/** Hosted: Your account, under who is signed in, opens the hosting service's account page. */
export const Hosted: Story = {
  args: { accountUrl: 'https://pagasae.aeolus-fleet.dev/account' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('account-menu'));
  },
};

/** With a guide for the session (decision 0024): Take the tour opens it again. */
export const WithGuide: Story = {
  args: { onTakeTour: fn() },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('account-menu'));
  },
};

/** A viewer session (decision 0022): it reads the fleet only, has no email and no theme, and keeps Sign out. */
export const Viewer: Story = {
  args: { account: { kind: 'viewer', session: { device: 'Mac · Safari', since: new Date('2026-10-01T14:10:00').toISOString() } }, accountUrl: 'https://pagasae.aeolus-fleet.dev/account' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('account-menu'));
  },
};

/** Dark chosen, on a session that began on another day. */
export const DarkSinceYesterday: Story = {
  args: {
    account: { ...ACCOUNT, theme: 'dark', session: { device: 'Windows · Edge', since: new Date('2026-09-30T18:40:00').toISOString() } },
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('account-menu'));
  },
};

/** The 64 px rail, 640 to 1023 px: the button is its avatar. */
export const Rail: Story = {
  decorators: [
    (Story) => (
      <div className="flex min-h-120 w-(--size-rail) flex-col justify-end border-r border-border bg-sidebar p-2.5 [&_[data-testid=account-menu]>span]:sr-only [&_[data-testid=account-menu]>svg]:hidden">
        <Story />
      </div>
    ),
  ],
};

/** Phone: the TopBar Avatar, closed. */
export const PhoneClosed: Story = {
  render: (args) => <AccountMenuSheet {...args} />,
  globals: { viewport: { value: 'mobile1' } },
};

/** Phone: the same content as a bottom Sheet, Theme as a segmented control, Cancel last. */
export const PhoneOpen: Story = {
  render: (args) => <AccountMenuSheet {...args} />,
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('account-menu'));
  },
};

/** Phone, signing out. */
export const PhoneSigningOut: Story = {
  args: { isSigningOut: true },
  render: (args) => <AccountMenuSheet {...args} />,
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('account-menu'));
  },
};

/** Phone, hosted: Your account under who is signed in. */
export const PhoneHosted: Story = {
  args: { accountUrl: 'https://pagasae.aeolus-fleet.dev/account' },
  render: (args) => <AccountMenuSheet {...args} />,
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('account-menu'));
  },
};

/** On phone: Settings, whenever it is offered, is in the account sheet (#245, #503). */
export const SheetWithSettings: Story = {
  args: { settingsHref: '/settings' },
  render: (args) => <AccountMenuSheet {...args} />,
};

/** On phone with the networking plugin connected: Network sits above Settings in the account sheet (#503). */
export const SheetWithNetwork: Story = {
  args: { settingsHref: '/settings', networkHref: '/network' },
  render: (args) => <AccountMenuSheet {...args} />,
};
