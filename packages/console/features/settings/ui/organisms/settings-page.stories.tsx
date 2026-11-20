import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { THEMES } from '@aeolus-fleet/common';
import type { AppsAndFleetsState, AvatarMenuProps } from '@aeolus-fleet/ui';
import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { ConsoleFrame, type ConsoleNav } from '../../../../components/organisms/console-frame';
import { ListPage } from '../../../../components/organisms/list-page';
import { ACCOUNT_MENU, ACCOUNT_SWITCHER, AEOLUS_SWITCHER, ARGO_MENU, VIEWER_MENU } from '../../../../lib/fixtures/header.fixtures';
import { AccountSettings } from './account-settings';
import { HelpSettings } from './help-settings';
import { NetworkSettingsRow } from './network-settings-row';
import { OwnSignIn } from './own-sign-in';
import { SettingsLoading } from './settings-loading';
import { ThemeSettings } from './theme-settings';
import { TrierarchPluginConnection } from './trierarch-plugin-connection';

const SHIP_ID = 'shp_01m4ahmavehywpqm4hnbgzs03w';
const SHORTCUTS = [
  { keys: ['⌘', 'K'], label: 'Search ships or jump to' },
  { keys: ['⌘', '↵'], label: 'Send a message' },
];

/** Each sign-in the mockups draw Settings for (docs/design/app-navigation, where the account menu's items go). */
type SignIn = 'account' | 'argo' | 'viewer' | 'single';

interface SettingsPageProps {
  signIn: SignIn;
  isSigningInAsArgo?: boolean;
  /** Before what Settings shows is read: its loading shape, under the title alone. */
  isLoading?: boolean;
}

const SWITCHERS: Record<SignIn, { switcher: AppSwitcherModel; state: AppsAndFleetsState; account: AvatarMenuProps }> = {
  account: { switcher: ACCOUNT_SWITCHER, state: { read: 'loaded' }, account: ACCOUNT_MENU },
  argo: { switcher: AEOLUS_SWITCHER, state: { read: 'loaded', limit: 'argo' }, account: ARGO_MENU },
  viewer: { switcher: AEOLUS_SWITCHER, state: { read: 'loaded', limit: 'viewer' }, account: VIEWER_MENU },
  single: { switcher: AEOLUS_SWITCHER, state: { read: 'loaded', limit: 'single-app' }, account: ARGO_MENU },
};

const NAV: Record<SignIn, ConsoleNav> = {
  account: { active: 'settings', hasTrierarchs: true },
  argo: { active: 'settings', hasTrierarchs: true, hasNetwork: true },
  viewer: { active: 'settings', hasTrierarchs: true },
  single: { active: 'settings' },
};

/**
 * The Settings page as the console composes it for each sign-in: the bar, the navigation with Settings current, then
 * Theme, Help, Your account where it applies, and how the installation runs for a session that manages the fleet.
 */
function SettingsPage({ signIn, isSigningInAsArgo = false, isLoading = false }: SettingsPageProps) {
  const { switcher, state, account } = SWITCHERS[signIn];
  const canManageInstallation = signIn !== 'viewer';
  if (isLoading) {
    return (
      <ConsoleFrame nav={NAV[signIn]}>
        <ListPage title="Settings" live="live" switcher={switcher} switcherState={state} account={account} onSearch={fn()}>
          <SettingsLoading />
        </ListPage>
      </ConsoleFrame>
    );
  }
  return (
    <ConsoleFrame nav={NAV[signIn]}>
      <ListPage
        title="Settings"
        description={canManageInstallation ? 'How this console looks for you, and how this installation runs.' : 'How this console looks for you.'}
        live="live"
        switcher={switcher}
        switcherState={state}
        account={account}
        onSearch={fn()}
      >
        {signIn === 'argo' ? <NetworkSettingsRow /> : null}
        <ThemeSettings theme="light" themes={THEMES} hasThemeSwitch={signIn !== 'viewer'} onThemeChange={fn()} />
        <HelpSettings shortcuts={SHORTCUTS} helpUrl="https://github.com/ThomasHendrickx/aeolus-fleet" onTakeTour={fn()} />
        {signIn === 'account' ? <AccountSettings accountUrl="https://account.acme.example/account" onSignInAsArgo={fn()} isSigningInAsArgo={isSigningInAsArgo} /> : null}
        {signIn === 'single' ? <OwnSignIn email="argo@acme.example" hasPassword isSaving={false} isSaved={false} onSave={fn()} /> : null}
        {canManageInstallation && signIn !== 'single' ? (
          <TrierarchPluginConnection
            settings={{ state: 'connected', ship: { shipId: SHIP_ID, name: 'trierarch-plugin' }, lastShipId: SHIP_ID, scopes: { kind: 'read', missingScopes: [] } }}
            onRetry={() => Promise.resolve()}
            onConnect={fn()}
            isConnecting={false}
            hasConnected={false}
          />
        ) : null}
      </ListPage>
    </ConsoleFrame>
  );
}

const meta = {
  title: 'Pages/Settings',
  component: SettingsPage,
  args: { signIn: 'account' },
  decorators: [
    (Story) => (
      <div className="-m-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const PHONE = { viewport: { value: 'mobile1' } };

/** The headings of the page's sections, in order. */
function sectionsOf(canvasElement: HTMLElement): string[] {
  return within(canvasElement)
    .getAllByRole('heading', { level: 2 })
    .filter((heading) => heading.getClientRects().length > 0)
    .map((heading) => heading.textContent);
}

/** An account Account names, allowed as argo: Theme, Help with the tour, Your account with its pages and Sign in as argo, then the trierarch plugin. */
export const Account: Story = {
  play: async ({ canvasElement }) => {
    await expect(sectionsOf(canvasElement)).toEqual(['Theme', 'Help', 'Your account', 'Trierarchs']);
    await expect(within(canvasElement).getByRole('button', { name: 'Account: Your account' })).toBeVisible();
  },
};
export const AccountPhone: Story = { ...Account, globals: PHONE };
export const AccountDark: Story = { ...Account, globals: { theme: 'dark' } };
export const AccountPhoneDark: Story = { ...Account, globals: { ...PHONE, theme: 'dark' } };

/** Sign in as argo working: the row says so with a busy icon and waits. */
export const SigningInAsArgo: Story = { args: { isSigningInAsArgo: true } };
export const SigningInAsArgoPhone: Story = { args: { isSigningInAsArgo: true }, globals: PHONE };

/** The account panel at the end of the bar: who is signed in and Sign out only. */
export const AccountPanel: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Account: Your account' }));
    const panel = await within(document.body).findByTestId('avatar-menu-panel');
    await expect(within(panel).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Sign out']);
    await expect(panel).toHaveTextContent('Signed in with your account');
  },
};
export const AccountPanelPhone: Story = {
  globals: PHONE,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Account: Your account' }));
    const sheet = await within(document.body).findByTestId('avatar-menu-sheet');
    await expect(within(sheet).getAllByRole('button').map((button) => button.textContent)).toEqual(['Sign out', 'Cancel']);
  },
};

/** argo with the networking plugin connected: on phone Network first; Theme, Help with the tour, the trierarch plugin. */
export const Argo: Story = {
  args: { signIn: 'argo' },
  play: async ({ canvasElement }) => {
    await expect(sectionsOf(canvasElement)).toEqual(['Theme', 'Help', 'Trierarchs']);
  },
};
export const ArgoPhone: Story = {
  args: { signIn: 'argo' },
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const network = canvas.getByRole('link', { name: 'Network' });
    await expect(network.getBoundingClientRect().top).toBeLessThan(canvas.getByRole('heading', { name: 'Theme' }).getBoundingClientRect().top);
    const tabs = within(canvas.getAllByRole('navigation', { name: 'Console' }).find((navigation) => navigation.getClientRects().length > 0) ?? canvasElement).getAllByRole('link');
    await expect(tabs.at(-1)).toHaveAttribute('aria-current', 'page');
    await expect(tabs.at(-1)).toHaveTextContent(/^Settings$/);
  },
};
export const ArgoDark: Story = { args: { signIn: 'argo' }, globals: { theme: 'dark' } };
export const ArgoPhoneDark: Story = { args: { signIn: 'argo' }, globals: { ...PHONE, theme: 'dark' } };

/** The viewer: the theme as a line without a switch, and Help with the tour; nothing of how the installation runs. */
export const Viewer: Story = {
  args: { signIn: 'viewer' },
  play: async ({ canvasElement }) => {
    await expect(sectionsOf(canvasElement)).toEqual(['Theme', 'Help']);
    await expect(within(canvasElement).getByText('How this console looks for you.')).toBeVisible();
  },
};
export const ViewerPhone: Story = { ...Viewer, globals: PHONE };
export const ViewerDark: Story = { ...Viewer, globals: { theme: 'dark' } };
export const ViewerPhoneDark: Story = { ...Viewer, globals: { ...PHONE, theme: 'dark' } };

/** A single-app self-hosted installation, signed in as argo: Theme, Help with the tour, argo's own sign-in; no Your account. */
export const SingleApp: Story = {
  args: { signIn: 'single' },
  play: async ({ canvasElement }) => {
    await expect(sectionsOf(canvasElement)).toEqual(['Theme', 'Help', 'Sign-in']);
  },
};
export const SingleAppPhone: Story = { ...SingleApp, globals: PHONE };
export const SingleAppDark: Story = { ...SingleApp, globals: { theme: 'dark' } };
export const SingleAppPhoneDark: Story = { ...SingleApp, globals: { ...PHONE, theme: 'dark' } };

/** The Apps and fleets panel of a single-app installation, from the bar: Console alone, and why. */
export const SingleAppPanel: Story = {
  args: { signIn: 'single' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getAllByRole('button', { name: 'Apps and fleets' }).find((button) => button.getClientRects().length > 0) ?? canvasElement);
    const notice = await within(document.body).findByText('Only Console is configured in this installation. There are no other apps to open.');
    await waitFor(() => expect(notice).toBeVisible());
  },
};
export const SingleAppPanelPhone: Story = { ...SingleAppPanel, globals: PHONE };

/** Before what Settings shows is read: the title and the sections' shape, no description and no theme switch, so nothing flips in as each read answers. */
export const Loading: Story = {
  args: { signIn: 'viewer', isLoading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(canvas.getByRole('status')).toHaveTextContent('Loading Settings');
    await expect(canvas.queryByRole('button', { name: 'Light' })).toBeNull();
    await expect(canvas.queryByText('A viewer sign-in shows this browser’s theme and has no theme switch.')).toBeNull();
    await expect(sectionsOf(canvasElement)).toEqual([]);
  },
};
export const LoadingPhone: Story = { ...Loading, globals: PHONE };
