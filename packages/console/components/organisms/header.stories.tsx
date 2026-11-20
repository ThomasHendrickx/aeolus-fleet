import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';

import { Header } from './header';
import { AVATAR_MENU, SWITCHER } from '../../lib/fixtures/header.fixtures';

const meta = {
  title: 'Organisms/Header',
  component: Header,
  args: { breadcrumb: 'Fleet overview', live: 'live', switcher: SWITCHER, account: AVATAR_MENU, onCompose: fn(), onSearch: fn() },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The visible bar: the desktop one from 640 px, the phone one below. */
function barOf(canvasElement: HTMLElement): HTMLElement {
  const bar = [...canvasElement.querySelectorAll<HTMLElement>('[data-slot="app-header"]')].find((header) => header.getClientRects().length > 0);
  if (bar === undefined) {
    throw new Error('no bar shows');
  }
  return bar;
}

/**
 * The bar every Aeolus app shows (docs/design/app-navigation, section 4): the launcher, Console and the Acme pill,
 * the breadcrumb, Live, the Search field and Compose, then the account button at the very end.
 */
export const Live: Story = {
  play: async ({ canvasElement }) => {
    const bar = within(barOf(canvasElement));
    await expect(bar.getByRole('button', { name: 'Apps and fleets' })).toBeVisible();
    await expect(bar.getByTestId('app-switcher-fleet-pill')).toHaveTextContent('Acme');
    await expect(bar.getByTestId('header-breadcrumb')).toHaveTextContent(/^\/\s*Fleet overview$/);
    await expect(bar.getByTestId('header-search')).toHaveTextContent(/^Search$/);
    const controls = bar.getAllByRole('button');
    await expect(controls.at(0)).toHaveAccessibleName('Apps and fleets');
    await expect(controls.at(-1)).toHaveAccessibleName('Account: Signed in as argo');
  },
};
export const Reconnecting: Story = { args: { live: 'reconnecting' } };
export const Offline: Story = { args: { live: 'offline' } };

/** A page that offers no Compose. */
export const WithoutCompose: Story = { args: { onCompose: undefined } };

/** Without the CommandPalette: no search trigger. */
export const WithoutSearch: Story = { args: { onSearch: undefined } };

/** A member's page: every level above it links up to it. */
export const WithParents: Story = {
  args: {
    breadcrumb: 'tester-a1b2',
    parents: [
      { href: '/squadrons', label: 'Squadrons' },
      { href: '/squadrons/team-a1b2c3', label: 'team-a1b2c3' },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(barOf(canvasElement)).getByTestId('header-breadcrumb')).toHaveTextContent(/^\/\s*Squadrons\s*\/\s*team-a1b2c3\s*\/\s*tester-a1b2$/);
  },
};

/**
 * The same bar on phone (docs/design/app-navigation, section 4): the launcher, Console and the Acme pill, Live, the
 * search and Compose icons, and the avatar last, each control 44 px; the breadcrumb stays in the page.
 */
export const LivePhone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const bar = within(barOf(canvasElement));
    await expect(barOf(canvasElement)).toHaveAttribute('data-layout', 'phone');
    const controls = bar.getAllByRole('button');
    await expect(controls.map((control) => control.getAttribute('aria-label'))).toEqual(['Apps and fleets', 'Search ships or jump to', 'Compose', 'Account: Signed in as argo']);
    for (const control of controls) {
      await expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    await expect(bar.queryByTestId('header-breadcrumb')).toBeNull();
    await expect(bar.getByText('Live')).toBeVisible();
  },
};

/** Nothing of the phone bar scrolls sideways or is cut off at the narrowest phone. */
export const LongFleetNamePhone: Story = {
  args: { switcher: { ...SWITCHER, fleet: { ...SWITCHER.fleet, name: 'Northern harbour operations fleet' } } },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const bar = barOf(canvasElement);
    await expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
    await expect(within(bar).getByRole('button', { name: 'Account: Signed in as argo' }).getBoundingClientRect().right).toBeLessThanOrEqual(bar.getBoundingClientRect().right);
  },
};

/** A page with its own phone bar, as an open inbox conversation: on phone it shows in place of the bar, without the launcher. */
export const OwnPhoneBarPhone: Story = {
  args: { phoneBar: <header data-testid="own-phone-bar">Inbox</header> },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('own-phone-bar')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Apps and fleets' })).toBeNull();
  },
};
