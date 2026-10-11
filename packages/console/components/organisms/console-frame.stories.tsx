import { THEMES } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { ConsoleFrame } from './console-frame';

const meta = {
  title: 'Organisms/ConsoleFrame',
  component: ConsoleFrame,
  args: {
    nav: { active: 'overview', inboxCount: 3, attentionCount: 2 },
    account: {
      account: {
        kind: 'operator',
        email: 'operator@example.com',
        session: { device: 'Mac · Chrome', since: '2026-10-01T06:02:00.000Z' },
        theme: 'system',
      },
      themes: THEMES, onThemeChange: fn(),
      onSignOut: fn(),
      isSigningOut: false,
      now: new Date('2026-10-01T12:30:00.000Z'),
    },
    children: (
      <div className="m-8 flex min-h-80 items-center justify-center rounded-lg border border-dashed border-border font-mono text-id text-muted-foreground">
        ListPage or DetailPage
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div className="-m-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConsoleFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };

/** With squadrons and the trierarch plugin, which add them to the navigation. */
export const WithPlugins: Story = {
  args: { nav: { active: 'trierarchs', inboxCount: 3, attentionCount: 2, hasSquadrons: true, hasTrierarchs: true, trierarchsCount: 2, hasNetwork: true, hasSettings: true } },
};
export const WithPluginsPhone: Story = { ...WithPlugins, globals: { viewport: { value: 'mobile1' } } };
