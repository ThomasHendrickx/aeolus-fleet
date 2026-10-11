import { THEMES } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '../atoms/tabs';
import type { AccountMenuProps } from './account-menu';
import { ConsoleFrame } from './console-frame';
import { DetailPage } from './detail-page';

function Placeholder({ label, isTall = false }: { label: string; isTall?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center rounded-lg border border-dashed border-border font-mono text-id text-muted-foreground ${isTall ? 'min-h-80' : 'h-24'}`}
    >
      {label}
    </div>
  );
}

const account: AccountMenuProps = {
  account: {
    kind: 'operator',
    email: 'operator@example.com',
    session: { device: 'Mac · Chrome', since: '2026-10-01T06:02:00.000Z' },
    theme: 'system',
  },
  themes: THEMES,
  onThemeChange: fn(),
  onSignOut: fn(),
  isSigningOut: false,
  now: new Date('2026-10-01T12:30:00.000Z'),
};

const meta = {
  title: 'Organisms/DetailPage',
  component: DetailPage,
  args: {
    title: 'reviewer-01',
    parents: [{ href: '/', label: 'Fleet overview' }],
    live: 'live',
    onCompose: fn(),
    onSearch: fn(),
    header: <Placeholder label="ShipHeader" />,
    children: (
      <Tabs defaultValue="timeline">
        <TabsList variant="line">
          <TabsTrigger variant="line" value="timeline">
            Timeline
          </TabsTrigger>
          <TabsTrigger variant="line" value="messages">
            Messages
          </TabsTrigger>
        </TabsList>
        <TabsContent value="timeline">
          <Placeholder label="ShipTimeline" isTall />
        </TabsContent>
      </Tabs>
    ),
  },
  // Shown in the ConsoleFrame, as the signed-in route layout shows it.
  render: (args) => (
    <ConsoleFrame nav={{ active: 'overview', inboxCount: 3, attentionCount: 2 }} account={account}>
      <DetailPage {...args} />
    </ConsoleFrame>
  ),
  decorators: [
    (Story) => (
      <div className="-m-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
