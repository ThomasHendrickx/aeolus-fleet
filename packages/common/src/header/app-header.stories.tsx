import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { accountIdSchema, createIdGenerator } from '../index.js';
import { AppHeader } from './app-header.js';
import { appSwitcherOf } from './apps.js';

const newId = createIdGenerator();
const ACME = newId('fleet');

const meta = {
  title: 'Header/AppHeader',
  component: AppHeader,
  parameters: { layout: 'fullscreen' },
  args: {
    switcher: appSwitcherOf({
      list: {
        account: { id: accountIdSchema.parse('acc-charlotte'), email: 'charlotte@acme.example' },
        apps: [{ app: 'account', url: 'https://account.example/account#account' }],
        fleets: [{ id: ACME, name: 'Acme', argo: false, apps: [{ app: 'console', url: 'https://fleet.example/#console' }] }],
      },
      fleet: { id: ACME, name: 'Acme' },
      app: 'console',
    }),
    account: {
      name: 'charlotte@acme.example',
      signedInAs: 'account',
      accountUrl: 'https://account.example/account',
      theme: 'system',
      themes: ['light', 'dark', 'system'],
      hasTheme: true,
      onThemeChange: fn(),
      shortcuts: [{ keys: ['⌘', 'K'], label: 'Search or jump to' }],
      helpUrl: 'https://github.com/ThomasHendrickx/aeolus-fleet#readme',
      onSignOut: fn(),
      isSigningOut: false,
    },
    onSearch: fn(),
    children: <span className="text-body text-muted-foreground">Fleet overview</span>,
  },
} satisfies Meta<typeof AppHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The switcher in the title, the app's part, the search trigger and the avatar menu. */
export const Default: Story = {};

/** While the fleet in view is not known yet, the title's shape stands in. */
export const Loading: Story = { args: { switcher: undefined } };

/** The search trigger opens the palette. */
export const Search: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('header-search'));
    await expect(args.onSearch).toHaveBeenCalled();
  },
};
