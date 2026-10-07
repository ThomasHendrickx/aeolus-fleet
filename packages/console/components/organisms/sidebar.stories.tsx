import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { Sidebar } from './sidebar';

const meta = {
  title: 'Organisms/Sidebar',
  component: Sidebar,
  args: {
    active: 'overview',
    inboxCount: 3,
    attentionCount: 2,
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
  decorators: [
    (Story) => (
      <div className="-m-6 flex min-h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Full width from 1024 px; narrower canvases show the 64 px rail, with a dot for the count. */
export const OverviewActive: Story = {};

export const InboxActive: Story = { args: { active: 'inbox' } };

export const AttentionActive: Story = { args: { active: 'attention' } };

/** Counts hide until they are known, and when nothing needs attention. */
export const NoCounts: Story = { args: { inboxCount: undefined, attentionCount: undefined } };

/** With the trierarch plugin on: Trierarchs after Squadrons, counting its silent machines. */
export const WithTrierarchs: Story = { args: { hasSquadrons: true, hasTrierarchs: true, trierarchsCount: 1, hasSettings: true, active: 'trierarchs' } };
