import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { HarbourTile, type HarbourTileShip } from './harbour-tile.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

const ALERT: HarbourTileShip = { id: 'shp_alert', name: 'ecosystem-relationships', state: 'alert', note: 'No report change for 2 h', lastActivityAt: minutesAgo(120) };
const WAITING: HarbourTileShip = { id: 'shp_waiting', name: 'builder-gateway', state: 'waiting', note: 'Blocked: waiting for release 0.37.0', lastActivityAt: minutesAgo(25) };
const WORKING: HarbourTileShip = { id: 'shp_working', name: 'orchestrator-1', state: 'working', note: 'Cutting #189 into slices', lastActivityAt: minutesAgo(0) };
const IDLE: HarbourTileShip = { id: 'shp_idle', name: 'company-memory', state: 'idle', note: 'Last call: search', lastActivityAt: minutesAgo(40) };

const meta = {
  title: 'Harbour/HarbourTile',
  component: HarbourTile,
  args: { ship: WORKING, kind: 'agents', href: '#ship', now: NOW },
  decorators: [
    (Story) => (
      <div className="w-58">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HarbourTile>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Alert: filled in attention. */
export const Alert: Story = { args: { ship: ALERT } };

/** Waiting: filled in waiting. */
export const Waiting: Story = { args: { ship: WAITING } };

/** Working: filled in ok, with the live band. */
export const Working: Story = {
  args: { ship: WORKING },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('harbour-tile-live')).toBeInTheDocument();
  },
};

/** Idle stays plain, so colour marks only what is going on. */
export const Idle: Story = { args: { ship: IDLE, kind: 'gateway' } };

/** A person's tile carries the person icon. */
export const Person: Story = { args: { ship: { id: 'shp_thomas', name: 'thomas', state: 'waiting', note: '4 wait on you', lastActivityAt: minutesAgo(12) }, kind: 'people' } };

/** A plugin's tile. */
export const Plugin: Story = { args: { ship: { id: 'shp_squadrons', name: 'squadrons', state: 'working', note: 'design-sq: 3 on station', lastActivityAt: minutesAgo(1) }, kind: 'plugins' } };

/** The whole name wraps rather than being cut; a long note keeps two lines. */
export const LongNameAndNote: Story = {
  args: {
    ship: {
      id: 'shp_long',
      name: 'thomas-hendrickx1989-with-a-very-long-ship-name',
      state: 'idle',
      note: 'Signed in, nothing open, and a note long enough to need more than the two lines a tile gives it',
      lastActivityAt: minutesAgo(24 * 60 + 5),
    },
    kind: 'people',
  },
};

/** Before it reports: no note, and No activity yet. */
export const NoActivityYet: Story = {
  args: { ship: { id: 'shp_walker', name: 'walker-3', state: 'waiting', note: null, lastActivityAt: null } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('harbour-tile-age')).toHaveTextContent('No activity yet');
    await expect(within(canvasElement).getByTestId('harbour-tile')).toHaveAttribute('title', 'walker-3: Waiting');
  },
};

/** Six days ago: still counted in days. */
export const SixDaysAgo: Story = { args: { ship: { ...IDLE, name: 'aeolus-guide', note: 'Nothing open', lastActivityAt: minutesAgo(6 * 24 * 60 + 23 * 60) } } };
/** From a week on: the date. */
export const OlderThanAWeek: Story = { args: { ship: { ...IDLE, name: 'aeolus-guide', note: 'Nothing open', lastActivityAt: minutesAgo(6 * 24 * 60 + 12 * 60 + 24 * 60) } } };

/** With an href it is a link to the ship's page. */
export const Link: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: /orchestrator-1/ })).toHaveAttribute('href', '#ship');
  },
};

/** Without one it is not a link: no arrow, no lift. */
export const NotALink: Story = {
  args: { href: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('link')).toBeNull();
  },
};

/** Keyboard focus: the ring, and the arrow shows. */
export const KeyboardFocus: Story = {
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole('link').focus();
    await expect(within(canvasElement).getByRole('link')).toHaveFocus();
  },
};
