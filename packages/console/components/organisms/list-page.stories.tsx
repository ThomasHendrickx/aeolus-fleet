import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Plus } from 'lucide-react';
import { fn } from 'storybook/test';

import { Badge } from '../atoms/badge';
import { Button } from '@aeolus-fleet/ui';
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
