import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Ship } from 'lucide-react';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import { CommandPalette, type CommandGroup } from './command-palette.js';

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
