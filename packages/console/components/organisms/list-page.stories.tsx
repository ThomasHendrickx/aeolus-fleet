import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Plus } from 'lucide-react';
import { expect, fn, within } from 'storybook/test';

import { Button, Badge } from '@aeolus-fleet/ui';
import { ConsoleFrame } from './console-frame';
import { ListPage } from './list-page';
import { AVATAR_MENU, SWITCHER } from '../../lib/fixtures/header.fixtures';

function Placeholder({ label, isTall = false }: { label: string; isTall?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center rounded-lg border border-dashed border-border font-mono text-id text-muted-foreground ${isTall ? 'min-h-80' : 'h-10'}`}
    >
      {label}
    </div>
  );
}

const meta = {
  title: 'Organisms/ListPage',
  component: ListPage,
  args: {
    title: 'Fleet overview',
    description: 'Every ship in the fleet, live.',
    live: 'live',
    onCompose: fn(),
    onSearch: fn(),
    switcher: SWITCHER,
    account: AVATAR_MENU,
    primaryAction: (
      <Button variant="primary" icon={<Plus aria-hidden />}>
        Commission ship
      </Button>
    ),
    toolbar: <Placeholder label="Toolbar: search, filters, Show retired, count" />,
    children: <Placeholder label="FleetTable" isTall />,
  },
  // Shown in the ConsoleFrame, as the signed-in route layout shows it.
  render: (args) => (
    <ConsoleFrame nav={{ active: 'overview', inboxCount: 3, stuckCount: 2 }}>
      <ListPage {...args} />
    </ConsoleFrame>
  ),
  decorators: [
    (Story) => (
      <div className="-m-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };

/** A fact beside the title: the Trierarchs page shows the version the trierarch plugin runs. */
export const WithTitleMeta: Story = {
  args: {
    title: 'Trierarchs',
    description: 'Machines that run sessions for crew requests. The plugin picks a trierarch for each request.',
    titleMeta: <Badge variant="outline">trierarch plugin 0.20.0</Badge>,
  },
  render: (args) => (
    <ConsoleFrame nav={{ active: 'trierarchs', hasTrierarchs: true }}>
      <ListPage {...args} />
    </ConsoleFrame>
  ),
};
export const WithTitleMetaPhone: Story = { ...WithTitleMeta, globals: { viewport: { value: 'mobile1' } } };

/** The fleet overview's actions stay small in the title row on phone (isActionInTitleRow), beside the title and not under its description. */
export const ActionInTitleRowPhone: Story = {
  args: {
    description: '19 ships: 8 working, 7 idle, 3 waiting, 1 with an alert',
    isActionInTitleRow: true,
    primaryAction: (
      <div className="flex items-center gap-2">
        <Button isIconOnly aria-label="More actions" icon={<Plus aria-hidden />} />
        <Button variant="primary" icon={<Plus aria-hidden />}>
          Commission ship
        </Button>
      </div>
    ),
  },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const title = canvas.getByRole('heading', { name: 'Fleet overview' }).getBoundingClientRect();
    const action = canvas.getByRole('button', { name: 'Commission ship' }).getBoundingClientRect();
    await expect(action.top).toBeLessThan(title.bottom);
  },
};

/**
 * The fleet overview on phone (docs/design/app-navigation, section 4): the bar holds the launcher, Console and the
 * fleet, and the page shows its own title under it, as every page does.
 */
export const FleetOverviewPhone: Story = {
  args: { title: 'Fleet', description: '4 ships' },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1, name: 'Fleet' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Apps and fleets' })).toBeVisible();
  },
};

/**
 * The bar spans the full width above the sidebar (docs/design/app-navigation, section 4): the launcher at its very
 * start, the account button at its very end, and no account in the sidebar.
 */
export const BarAboveTheSidebar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = [...canvasElement.querySelectorAll<HTMLElement>('[data-slot="app-header"]')].find((header) => header.getClientRects().length > 0);
    const sidebar = canvasElement.querySelector('[data-slot="sidebar"]');
    await expect(bar?.getBoundingClientRect().left).toBe(canvasElement.getBoundingClientRect().left);
    await expect(sidebar?.getBoundingClientRect().top).toBeGreaterThanOrEqual(bar?.getBoundingClientRect().bottom ?? Infinity);
    await expect(canvas.getByRole('button', { name: 'Account: Signed in as argo' }).closest('[data-slot="app-header"]')).toBe(bar);
    await expect(sidebar?.querySelector('[data-testid="avatar-menu"]')).toBeNull();
  },
};

/**
 * Another fleet opened from the Apps and fleets panel (docs/design/app-navigation, section 4): the page says
 * "Console is open in Harbour." at its top, announced, the bar naming Harbour.
 */
export const Arrived: Story = {
  args: { switcher: { ...SWITCHER, fleet: { ...SWITCHER.fleet, name: 'Harbour' } }, arrival: { appLabel: 'Console', fleetName: 'Harbour' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Console is open in Harbour.')).toBeVisible();
    await expect(canvas.getByText('Console is open in Harbour.').closest('[role="status"]')).not.toBeNull();
    await expect(canvas.getByText('Console is open in Harbour.').getBoundingClientRect().top).toBeLessThan(canvas.getByRole('heading', { level: 1 }).getBoundingClientRect().top);
  },
};
export const ArrivedPhone: Story = { ...Arrived, globals: { viewport: { value: 'mobile1' } } };
