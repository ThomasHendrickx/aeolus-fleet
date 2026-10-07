import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { TabBar } from './tab-bar';

const meta = {
  title: 'Organisms/TabBar',
  component: TabBar,
  args: { active: 'fleet', inboxCount: 3, attentionCount: 2 },
  globals: { viewport: { value: 'mobile1' } },
} satisfies Meta<typeof TabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Phone only: switch the canvas to a phone viewport to see it. */
export const FleetActive: Story = {};

export const InboxActive: Story = { args: { active: 'inbox' } };

export const AttentionActiveNoCounts: Story = {
  args: { active: 'attention', inboxCount: undefined, attentionCount: undefined },
};

/** With squadrons and the trierarch plugin on: Trierarchs follows Squadrons, counting its silent machines. */
export const WithTrierarchs: Story = { args: { active: 'trierarchs', hasSquadrons: true, hasTrierarchs: true, trierarchsCount: 1 } };
