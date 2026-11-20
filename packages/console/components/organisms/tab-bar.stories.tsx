import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { TabBar } from './tab-bar';

const meta = {
  title: 'Organisms/TabBar',
  component: TabBar,
  args: { active: 'fleet', inboxCount: 3, stuckCount: 2 },
  globals: { viewport: { value: 'mobile1' } },
} satisfies Meta<typeof TabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Phone only: switch the canvas to a phone viewport to see it. */
export const FleetActive: Story = {};

export const InboxActive: Story = { args: { active: 'inbox' } };

export const HealthActiveNoCounts: Story = {
  args: { active: 'health', inboxCount: undefined, stuckCount: undefined },
};

/** With squadrons and the trierarch plugin on: Trierarchs follows Squadrons, counting its silent machines. */
export const WithTrierarchs: Story = { args: { active: 'trierarchs', hasSquadrons: true, hasTrierarchs: true, trierarchsCount: 1 } };

/** Settings is the last tab for every sign-in (docs/design/app-navigation, where the account menu's items go). */
export const SettingsLast: Story = {
  play: async ({ canvasElement }) => {
    const tabs = within(within(canvasElement).getByRole('navigation', { name: 'Console' })).getAllByRole('link');
    await expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual(['/', '/fleet-health', '/inbox', '/settings']);
    await expect(tabs.at(-1)).toHaveTextContent(/^Settings$/);
  },
};

export const SettingsActive: Story = {
  args: { active: 'settings' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  },
};

/** At its most tabs, squadrons and the trierarch plugin on: six, each label whole and each tab 44 px at 375 px. */
export const MostTabs: Story = {
  args: { hasSquadrons: true, hasTrierarchs: true, trierarchsCount: 1 },
  play: async ({ canvasElement }) => {
    const tabs = within(within(canvasElement).getByRole('navigation', { name: 'Console' })).getAllByRole('link');
    await expect(tabs).toHaveLength(6);
    for (const tab of tabs) {
      await expect(tab.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      await expect(tab.scrollWidth).toBeLessThanOrEqual(tab.clientWidth);
    }
  },
};
