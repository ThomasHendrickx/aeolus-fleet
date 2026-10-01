import { createIdGenerator } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import type { PaletteItem } from '../../lib/command-palette';
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
  { kind: 'page', id: 'attention', label: 'Needs attention', href: '/needs-attention' },
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
