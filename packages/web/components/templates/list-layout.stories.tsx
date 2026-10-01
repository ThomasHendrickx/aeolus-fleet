import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Plus } from 'lucide-react';
import { fn } from 'storybook/test';

import { Button } from '../atoms/button';
import { ListLayout } from './list-layout';

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
  title: 'Templates/ListLayout',
  component: ListLayout,
  args: {
    title: 'Fleet overview',
    description: 'Every ship in the fleet, live.',
    live: 'live',
    nav: { active: 'overview', inboxCount: 3, attentionCount: 2 },
    onCompose: fn(),
    onSearch: fn(),
    account: {
      account: {
        email: 'operator@example.com',
        session: { device: 'Mac · Chrome', since: '2026-10-01T06:02:00.000Z' },
        theme: 'system',
      },
      onThemeChange: fn(),
      onSignOut: fn(),
      isSigningOut: false,
      now: new Date('2026-10-01T12:30:00.000Z'),
    },
    primaryAction: (
      <Button variant="primary" icon={<Plus aria-hidden />}>
        Commission ship
      </Button>
    ),
    toolbar: <Placeholder label="Toolbar: search, filters, Show retired, count" />,
    children: <Placeholder label="FleetTable" isTall />,
  },
  decorators: [
    (Story) => (
      <div className="-m-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ListLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
