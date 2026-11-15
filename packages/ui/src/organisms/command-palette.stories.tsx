import type { Meta, StoryObj } from '@storybook/react-vite';
import { Ship } from 'lucide-react';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import type { AppPaletteGroup } from '@aeolus-fleet/common/rules';

import { appPaletteGroupOf, CommandPalette, type CommandGroup } from './command-palette.js';

const GROUPS: readonly CommandGroup[] = [
  {
    key: 'apps',
    label: 'Apps',
    entries: [
      { key: 'app:gateway', content: <span>Gateway</span>, href: '#gateway', name: 'Gateway' },
      { key: 'app:account', content: <span>Account</span>, href: '#account', name: 'Account' },
    ],
  },
  {
    key: 'pages',
    label: 'Go to',
    entries: [{ key: 'page:overview', content: (<><Ship aria-hidden className="size-(--size-icon)" /><span>Fleet overview</span></>) }],
  },
];

/** The groups for a query: each entry whose key matches what is typed. */
function groupsOf(query: string): readonly CommandGroup[] {
  const wanted = query.trim().toLowerCase();
  return GROUPS.map((group) => ({ ...group, entries: group.entries.filter((entry) => entry.key.includes(wanted)) })).filter((group) => group.entries.length > 0);
}

const meta = {
  title: 'Header/CommandPalette',
  component: CommandPalette,
  parameters: { layout: 'fullscreen' },
  args: {
    isOpen: true,
    onOpenChange: fn(),
    groupsOf,
    onSelect: fn(),
    label: 'Search or jump to',
    emptyMessage: (query: string) => `Nothing matches “${query}”.`,
  },
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

export const Default: Story = {};

/** While the entries load, rows in their shape stand in. */
export const Loading: Story = {
  args: { groupsOf: () => [], isLoading: true },
  play: async () => {
    await waitFor(() => expect(screen.getByTestId('command-palette-loading')).toBeVisible());
  },
};

export const NoResults: Story = {
  args: { initialQuery: 'deploy' },
  play: async () => {
    await expect(await screen.findByTestId('command-palette')).toHaveTextContent('Nothing matches “deploy”.');
  },
};

/** An entry of this app is handed over and the palette closes. */
export const Select: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByText('Fleet overview'));
    await expect(args.onSelect).toHaveBeenCalledWith('page:overview');
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

/** Another app: the palette stays open and says it is opening, until the browser leaves. */
export const OpeningAnotherApp: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByText('Gateway'));
    await waitFor(() => expect(screen.getByText('Opening Gateway')).toBeVisible());
    await expect(screen.getByTestId('command-palette-input')).toBeDisabled();
    await expect(args.onOpenChange).not.toHaveBeenCalled();
  },
};

/** Phone: full screen, with Cancel (H6). */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };

/** Each change of the query is handed out as typed, so the app can ask the server for what matches. */
export const HandsOutTheQuery: Story = {
  args: { onQueryChange: fn() },
  play: async ({ args }) => {
    await userEvent.type(screen.getByTestId('command-palette-input'), 'ga');
    await waitFor(() => expect(args.onQueryChange).toHaveBeenLastCalledWith('ga'));
  },
};

const MCP_ADDRESS = 'https://gateway.acme.example/mcp';

/** Other apps' entries, as the open app's server hands them over (header-across-apps A2, A3). */
const OTHER_APPS: readonly AppPaletteGroup[] = [
  { app: 'gateway', label: 'Gateway', entries: [{ key: 'gateway:mcp-address', label: 'Copy MCP address', keywords: ['mcp'], icon: 'copy', copyText: MCP_ADDRESS }] },
  { app: 'account', label: 'Account', entries: [{ key: 'account:rights', label: 'Your rights', keywords: [], icon: 'shield', href: '#account-rights' }] },
];

/** Puts a clipboard in place of the browser's, so a story sees what was copied, or a copy fail. */
function withClipboard(writeText: (text: string) => Promise<void>): () => void {
  const held = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return () => {
    Reflect.deleteProperty(navigator, 'clipboard');
    if (held !== undefined) {
      Object.defineProperty(Navigator.prototype, 'clipboard', held);
    }
  };
}

/** Other apps' pages and actions under each app's name, each row naming the app it opens (M2). */
export const AcrossApps: Story = {
  args: { groupsOf: () => OTHER_APPS.map(appPaletteGroupOf) },
  play: async ({ args }) => {
    // Given the palette shows Account's Your rights
    const rights = await screen.findByText('Your rights');
    // Then the row names the app it opens
    await expect(screen.getAllByTestId('command-palette-item-app').map((app) => app.textContent)).toContain('Account');
    // When the person chooses it
    await userEvent.click(rights);
    // Then the palette says it is opening Account, until the browser leaves
    await waitFor(() => expect(screen.getByText('Opening Account')).toBeVisible());
    await expect(args.onOpenChange).not.toHaveBeenCalled();
  },
};

const copied: string[] = [];

/** Waits for the search field and Copy MCP address, active, then focuses the field: Enter is the field's key. */
async function focusOnCopyMcpAddress(): Promise<void> {
  const input = await screen.findByTestId('command-palette-input');
  await waitFor(() => expect(screen.getByText('Copy MCP address').closest('[role="option"]')).toHaveAttribute('aria-selected', 'true'));
  input.focus();
  await waitFor(() => expect(input).toHaveFocus());
}

/** Copy MCP address copies and says Copied, with no app opening (A3). */
export const CopyMcpAddress: Story = {
  args: { groupsOf: () => OTHER_APPS.map(appPaletteGroupOf), initialQuery: 'mcp' },
  beforeEach: () =>
    withClipboard((text) => {
      copied.push(text);
      return Promise.resolve();
    }),
  play: async ({ args }) => {
    // Given the palette shows the gateway's Copy MCP address, the search field focused
    await focusOnCopyMcpAddress();
    // When the person presses Enter
    await userEvent.keyboard('{Enter}');
    // Then the address is copied, the row says Copied, and nothing opens or closes
    await waitFor(() => expect(screen.getByTestId('command-palette')).toHaveTextContent('Copied'));
    await expect(copied).toContain(MCP_ADDRESS);
    await expect(args.onOpenChange).not.toHaveBeenCalled();
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};

/** A copy the browser refuses says so on the row, and what to do. */
export const CopyFailed: Story = {
  args: { groupsOf: () => OTHER_APPS.map(appPaletteGroupOf), initialQuery: 'mcp' },
  beforeEach: () => withClipboard(() => Promise.reject(new Error('denied'))),
  play: async () => {
    await focusOnCopyMcpAddress();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('command-palette')).toHaveTextContent('Couldn’t copy. Try again'));
  },
};
