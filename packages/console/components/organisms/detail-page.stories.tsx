import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@aeolus-fleet/ui';

import { ConsoleFrame } from './console-frame';
import { DetailPage } from './detail-page';
import { AVATAR_MENU, SWITCHER } from '../../lib/fixtures/header.fixtures';

function Placeholder({ label, isTall = false }: { label: string; isTall?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center rounded-lg border border-dashed border-border font-mono text-id text-muted-foreground ${isTall ? 'min-h-80' : 'h-24'}`}
    >
      {label}
    </div>
  );
}


const meta = {
  title: 'Organisms/DetailPage',
  component: DetailPage,
  args: {
    switcher: SWITCHER,
    account: AVATAR_MENU,
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
    <ConsoleFrame nav={{ active: 'overview', inboxCount: 3, stuckCount: 2 }}>
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
/**
 * A detail page keeps the bar on phone (docs/design/app-navigation, section 4): the launcher and the account button,
 * with the breadcrumb in the page, each level above it a link up to it.
 */
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Apps and fleets' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Account: Signed in as argo' })).toBeVisible();
    const breadcrumb = canvas.getAllByRole('navigation', { name: 'Breadcrumb' }).find((navigation) => navigation.getClientRects().length > 0);
    await expect(breadcrumb).toHaveTextContent(/^Fleet overview\s*\/\s*reviewer-01$/);
    await expect(within(breadcrumb ?? canvasElement).getByRole('link', { name: 'Fleet overview' })).toHaveAttribute('href', '/');
  },
};

/** Several levels above a squadron member's page, on phone: each links up to it. */
export const MemberPhone: Story = {
  args: {
    title: 'tester-a1b2',
    parents: [
      { href: '/squadrons', label: 'Squadrons' },
      { href: '/squadrons/team-a1b2c3', label: 'team-a1b2c3' },
    ],
  },
  globals: { viewport: { value: 'mobile1' } },
};
