import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import { DELIVERING_HEALTH, HEALTH_NOW, HETZNER, QUIET_HEALTH, STUCK_HEALTH } from '../../../../lib/fixtures/health.fixtures';
import { placeNote, type StuckPlace } from '../../services/health-view';
import { HealthBoard } from './health-board';

const SCOUT_LAST_SEEN = '2026-10-14T07:31:00.000Z';

function notesOf(places: readonly StuckPlace[]): ReadonlyMap<StuckPlace, string> {
  const notes = new Map<StuckPlace, string>();
  for (const place of places) {
    const note = placeNote(place, { facts: { lastSeenAt: SCOUT_LAST_SEEN }, since: (at) => `at ${at.toISOString().slice(11, 16)}` });
    if (note !== null) {
      notes.set(place, note);
    }
  }
  return notes;
}

const MACHINES = [
  { id: 'shp_01m50fadab99nv2shqvz0sf206', name: 'mac-studio', ships: 6 },
  { id: HETZNER.id, name: HETZNER.name, ships: 2 },
];

const meta = {
  title: 'Organisms/HealthBoard',
  component: HealthBoard,
  args: {
    state: 'ready',
    health: STUCK_HEALTH,
    onRetry: fn(),
    notes: notesOf(STUCK_HEALTH.stuck),
    renderLiveness: (machine) => <span className="text-meta text-muted-foreground">{machine.id === HETZNER.id ? 'Silent' : 'Crewing'}</span>,
    now: HEALTH_NOW,
  },
} satisfies Meta<typeof HealthBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nine deliveries stuck in five places: the verdict, the trend with its marks, a card per cause. */
export const Stuck: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('health-stuck-count')).toHaveTextContent('9');
    await expect(canvas.getAllByTestId('health-cause')).toHaveLength(4);
  },
};

export const StuckDark: Story = { globals: { theme: 'dark' } };

/** With the trierarch plugin: the machines last, hetzner-01 with the two stuck on its ships. */
export const WithMachines: Story = {
  args: { machines: MACHINES },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('2 deliveries stuck on its ships')).toBeVisible();
  },
};

/** The good state: nothing stuck, the trend of the week and the acknowledged. */
export const Delivering: Story = {
  args: { health: DELIVERING_HEALTH, notes: new Map() },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Delivering. Nothing is stuck.')).toBeVisible();
    await expect(canvas.queryAllByTestId('health-cause')).toHaveLength(0);
  },
};

export const DeliveringDark: Story = { args: { health: DELIVERING_HEALTH, notes: new Map() }, globals: { theme: 'dark' } };

/** Nothing stuck and nothing acknowledged in the last 24 hours. */
export const Quiet: Story = {
  args: { health: QUIET_HEALTH, notes: new Map() },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Nothing acknowledged in the last 24 h.')).toBeVisible();
  },
};

export const Loading: Story = { args: { state: 'loading', health: undefined } };

export const LoadFailed: Story = {
  args: { state: 'error', health: undefined },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

export const Phone: Story = { args: { machines: MACHINES }, globals: { viewport: { value: 'mobile1' } } };

export const PhoneDark: Story = { args: { machines: MACHINES }, globals: { viewport: { value: 'mobile1' }, theme: 'dark' } };
