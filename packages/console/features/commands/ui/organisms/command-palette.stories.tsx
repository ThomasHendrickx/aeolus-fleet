import { createIdGenerator } from '@aeolus-fleet/common';
import type { AppPaletteGroup } from '@aeolus-fleet/common/rules';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, waitFor } from 'storybook/test';

import type { PaletteItem } from '../../services/command-palette';
import { CommandPalette } from './command-palette';

const newId = createIdGenerator();

function aShip(ship: { name: string; type: string; status: 'crewed' | 'awaitingCrew' }): PaletteItem {
  const id = newId('ship');
  return { kind: 'ship', id, ...ship, href: `/ships/${id}` };
}

const ITEMS: PaletteItem[] = [
  { kind: 'action', id: 'compose', label: 'Compose message' },
  { kind: 'action', id: 'commission', label: 'Commission ship' },
  aShip({ name: 'tester-01', type: 'tester', status: 'crewed' }),
  aShip({ name: 'builder-web', type: 'builder', status: 'awaitingCrew' }),
  aShip({ name: 'reviewer-01', type: 'reviewer', status: 'crewed' }),
  aShip({ name: 'reviewer-02', type: 'reviewer', status: 'crewed' }),
  { kind: 'page', id: 'overview', label: 'Fleet overview', href: '/' },
  { kind: 'page', id: 'inbox', label: 'Operator inbox', href: '/inbox' },
  { kind: 'page', id: 'health', label: 'Health', href: '/fleet-health' },
];

const meta = {
  title: 'Organisms/CommandPalette',
  component: CommandPalette,
  parameters: { layout: 'fullscreen' },
  args: { isOpen: true, onOpenChange: fn(), items: ITEMS, onSelect: fn() },
  decorators: [
    (Story) => (
      <div className="min-h-160">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No query: every group, the first option active. */
export const Default: Story = {};

/** Searching: the ships that match by name or type, and the pages that match. */
export const Results: Story = { args: { initialQuery: 'rev' } };

export const NoResults: Story = { args: { initialQuery: 'deploy' } };

/** Phone: the TopBar's search icon opens it full screen, with Cancel. */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };

/** With squadrons on: Form squadron, a squadron with its state, a blueprint and the Squadrons page. */
export const SquadronsOn: Story = {
  args: {
    items: [
      ...ITEMS,
      { kind: 'action', id: 'form-squadron', label: 'Form squadron' },
      { kind: 'squadron', id: 'aeolus-a1b2c3', blueprint: 'aeolus', state: 'sailing', href: '/squadrons/aeolus-a1b2c3' },
      { kind: 'blueprint', id: 'github.com/acme/templates#aeolus', name: 'aeolus', version: 4, href: '/squadrons/blueprints/aeolus' },
      { kind: 'page', id: 'squadrons', label: 'Squadrons', href: '/squadrons' },
    ],
  },
};

/** The other apps' pages and actions, as the web app's server hands them over (header-across-apps A2, A3, M2). */
const OTHER_APPS: readonly AppPaletteGroup[] = [
  {
    app: 'gateway',
    label: 'Gateway',
    entries: [
      { key: 'gateway:fleet', label: 'Your fleet', keywords: [], icon: 'lock', href: '#gateway-fleet' },
      { key: 'gateway:mcp-address', label: 'Copy MCP address', keywords: ['mcp'], icon: 'copy', copyText: 'https://gateway.acme.example/mcp' },
    ],
  },
  {
    app: 'account',
    label: 'Account',
    entries: [
      { key: 'account:home', label: 'Home', keywords: [], icon: 'home', href: '#account' },
      { key: 'account:rights', label: 'Your rights', keywords: [], icon: 'shield', href: '#account-rights' },
      { key: 'account:updates', label: 'Email updates', keywords: [], icon: 'mail', href: '#account-updates' },
    ],
  },
];

/** With the other apps the account may open: each under its name after the console's own groups, each row naming the app it opens (M2). */
export const OtherApps: Story = { args: { otherApps: OTHER_APPS } };

/** Typing "mcp": the gateway's Copy MCP address, which copies (A3). */
export const OtherAppsMcp: Story = {
  args: { otherApps: OTHER_APPS, initialQuery: 'mcp' },
  play: async () => {
    await waitFor(() => expect(screen.getByText('Copy MCP address')).toBeVisible());
    await expect(screen.queryByText('Fleet overview')).toBeNull();
  },
};

/** Typing "rights": Account's Your rights, found from the console (A2). */
export const OtherAppsRights: Story = {
  args: { otherApps: OTHER_APPS, initialQuery: 'rights' },
  play: async () => {
    await waitFor(() => expect(screen.getByText('Your rights')).toBeVisible());
    await expect(screen.getByTestId('command-palette-item-app')).toHaveTextContent('Account');
  },
};

/** While the ships load, rows in their shape stand in. */
export const Loading: Story = { args: { items: [], isLoading: true } };
