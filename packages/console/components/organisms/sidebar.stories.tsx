import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { expect, within } from 'storybook/test';

import { Sidebar } from './sidebar';
import { AVATAR_MENU } from '../../lib/fixtures/header.fixtures';

const meta = {
  title: 'Organisms/Sidebar',
  component: Sidebar,
  args: {
    active: 'overview',
    inboxCount: 2,
    stuckCount: 2,
    needsCrewCount: 1,
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

/**
 * Full width from 1024 px; narrower canvases show the 64 px rail, with a dot for the count. The brand is the mark and
 * "Aeolus"; Health, Needs crew and Operator inbox count (docs/design/fleet-overview/console-desktop.html).
 */
export const OverviewActive: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText('Operator console')).toBeNull();
    await expect(canvas.getByTestId('nav-health-count')).toHaveTextContent('2');
    await expect(canvas.getByTestId('nav-needs-crew-count')).toHaveTextContent('1');
    await expect(canvas.getByTestId('nav-inbox')).toHaveAccessibleName(/^Operator inbox/);
  },
};

export const InboxActive: Story = { args: { active: 'inbox' } };

export const HealthActive: Story = { args: { active: 'health' } };

/** Counts hide until they are known, and when nothing needs attention. */
export const NoCounts: Story = { args: { inboxCount: undefined, stuckCount: undefined } };

/** With the trierarch plugin on: Trierarchs after Squadrons, counting its silent machines. */
export const WithTrierarchs: Story = {
  args: { hasSquadrons: true, hasTrierarchs: true, trierarchsCount: 1, hasSettings: true, active: 'trierarchs' },
  play: async ({ canvasElement }) => {
    const navigation = within(canvasElement).getByRole('navigation', { name: 'Console' });
    const labels = within(navigation).getAllByRole('link').map((link) => link.textContent);
    await expect(labels.indexOf('Usage')).toBe(labels.findIndex((label) => label.startsWith('Trierarchs')) + 1);
  },
};

/** Usage is the current page. */
export const UsageActive: Story = {
  args: { hasTrierarchs: true, active: 'usage' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('nav-usage')).toHaveAttribute('aria-current', 'page');
  },
};

/** Without the trierarch plugin there is no Usage. */
export const WithoutTrierarchsNoUsage: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('nav-usage')).toBeNull();
  },
};
/** Argo with the networking plugin connected: Network, then Settings, under the other destinations in the one list (decision 0036). */
export const WithNetwork: Story = {
  args: { hasNetwork: true, hasSettings: true, active: 'network' },
  play: async ({ canvasElement }) => {
    const navigation = within(canvasElement).getByRole('navigation', { name: 'Console' });
    const destinations = within(navigation).getAllByRole('link').map((link) => link.dataset.testid);
    await expect(destinations).toEqual(['nav-overview', 'nav-health', 'nav-needs-crew', 'nav-inbox', 'nav-network', 'nav-settings']);
  },
};

/** The avatar menu in the foot: who is signed in and the fleet in view (docs/design/fleet-overview). */
export const WithAccount: Story = {
  args: { account: AVATAR_MENU, fleetName: 'Acme fleet' },
  play: async ({ canvasElement }) => {
    const foot = within(canvasElement).getByTestId('avatar-menu');
    await expect(foot).toHaveTextContent('argo');
    await expect(foot).toHaveTextContent('Acme fleet');
  },
};
