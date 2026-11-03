import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { HarbourTile, type HarbourTileShip } from './harbour-tile.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

const ALERT: HarbourTileShip = { id: 'shp_alert', name: 'ecosystem-relationships', state: 'alert', note: 'No report change for 2 h', lastActivityAt: minutesAgo(120) };
const AWAITING_CREW: HarbourTileShip = { id: 'shp_awaiting', name: 'walker-3', state: 'awaitingCrew', note: 'Awaiting crew', lastActivityAt: null };
const BLOCKED: HarbourTileShip = { id: 'shp_blocked', name: 'builder-gateway', state: 'blocked', note: 'Blocked: waiting for release 0.37.0', lastActivityAt: minutesAgo(25) };
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

/** The tile's state as ShipState draws it: its word, its icon and the tone that means it (docs/design/state-colours). */
async function expectState(canvasElement: HTMLElement, { word, tone }: { word: string; tone: string }) {
  const state = within(within(canvasElement).getByTestId('harbour-tile')).getByTestId('ship-state');
  await expect(state).toHaveTextContent(word);
  await expect(state.querySelector('svg')).not.toBeNull();
  await expect(state).toHaveAttribute('data-tone', tone);
}

/** Alert: filled in attention, Coral. */
export const Alert: Story = { args: { ship: ALERT }, play: async ({ canvasElement }) => expectState(canvasElement, { word: 'Alert', tone: 'attention' }) };

/** Awaiting crew: filled in waiting, Amber. */
export const AwaitingCrew: Story = { args: { ship: AWAITING_CREW }, play: async ({ canvasElement }) => expectState(canvasElement, { word: 'Awaiting crew', tone: 'waiting' }) };

/** Blocked: filled in blocked, violet. */
export const Blocked: Story = { args: { ship: BLOCKED }, play: async ({ canvasElement }) => expectState(canvasElement, { word: 'Blocked', tone: 'blocked' }) };

/** Working: filled in active, Sea, with the live band. */
export const Working: Story = {
  args: { ship: WORKING },
  play: async ({ canvasElement }) => {
    await expectState(canvasElement, { word: 'Working', tone: 'active' });
    await expect(within(canvasElement).getByTestId('harbour-tile-live')).toBeInTheDocument();
  },
};

/** Idle stays plain and carries no tone, so colour marks only what is going on. */
export const Idle: Story = { args: { ship: IDLE, kind: 'gateway' }, play: async ({ canvasElement }) => expectState(canvasElement, { word: 'Idle', tone: 'none' }) };

/** The five side by side, light and dark, as the sheet draws Harbour's cards. */
export const LightAndDark: Story = {
  decorators: [(Story) => <Story />],
  render: () => (
    <div className="grid grid-cols-2">
      {(['', 'dark'] as const).map((mode) => (
        <div key={mode || 'light'} className={`${mode} grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2 bg-background p-4 text-foreground`}>
          {[ALERT, BLOCKED, AWAITING_CREW, WORKING, IDLE].map((ship) => (
            <HarbourTile key={ship.id} ship={ship} kind="agents" href="#ship" now={NOW} />
          ))}
        </div>
      ))}
    </div>
  ),
};

/** A person's tile carries the person icon. */
export const Person: Story = { args: { ship: { id: 'shp_thomas', name: 'thomas', state: 'awaitingCrew', note: '4 wait on you', lastActivityAt: minutesAgo(12) }, kind: 'people' } };

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
  args: { ship: { id: 'shp_walker', name: 'walker-3', state: 'awaitingCrew', note: null, lastActivityAt: null } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('harbour-tile-age')).toHaveTextContent('No activity yet');
    await expect(within(canvasElement).getByTestId('harbour-tile')).toHaveAttribute('title', 'walker-3: Awaiting crew');
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
