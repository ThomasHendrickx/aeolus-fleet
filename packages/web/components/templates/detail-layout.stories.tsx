import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '../atoms/tabs';
import { ShipHeader } from '../organisms/ship-header';
import { CREWED_SHIP, NOW, REVIEWER, TIMELINE } from '../organisms/ship-page.fixtures';
import { ShipTimeline } from '../organisms/ship-timeline';
import { DetailLayout } from './detail-layout';

const meta = {
  title: 'Templates/DetailLayout',
  component: DetailLayout,
  args: {
    title: 'reviewer-01',
    parent: { href: '/', label: 'Fleet overview' },
    live: 'live',
    nav: { active: 'overview', inboxCount: 3, attentionCount: 2 },
    onCompose: fn(),
    onSearch: fn(),
    account: {
      account: {
        kind: 'operator',
        email: 'operator@example.com',
        session: { device: 'Mac · Chrome', since: '2026-10-01T06:02:00.000Z' },
        theme: 'system',
      },
      onThemeChange: fn(),
      onSignOut: fn(),
      isSigningOut: false,
      now: new Date('2026-10-01T12:30:00.000Z'),
    },
    header: <ShipHeader ship={CREWED_SHIP} state="ready" now={NOW} />,
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
          <ShipTimeline shipId={REVIEWER.id} entries={TIMELINE} state="ready" now={NOW} onOpenMessage={fn()} />
        </TabsContent>
      </Tabs>
    ),
  },
  decorators: [
    (Story) => (
      <div className="-m-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DetailLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
