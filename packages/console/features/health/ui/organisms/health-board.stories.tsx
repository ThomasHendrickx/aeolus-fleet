import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import type { Health } from '@aeolus-fleet/common';

import { DELIVERING_HEALTH, HEALTH_NOW, HETZNER, QUIET_HEALTH, STUCK_HEALTH } from '../../../../lib/fixtures/health.fixtures';
import { placeNote, type StuckPlace } from '../../services/health-view';
import { HealthBoard, type HealthPartRead } from './health-board';

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

function read<T>(data: T): HealthPartRead<T> {
  return { data, isError: false, onRetry: fn() };
}

const LOADING = { data: undefined, isError: false, onRetry: fn() };
const FAILED = { data: undefined, isError: true, onRetry: fn() };

/** Each part of a health as read, each by its own read. */
function partsOf(health: Health) {
  return { stuck: read(health.stuck), stuckPerHour: read(health.stuckPerHour), acknowledged: read(health.acknowledged) };
}

const meta = {
  title: 'Organisms/HealthBoard',
  component: HealthBoard,
  args: {
    ...partsOf(STUCK_HEALTH),
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
  args: { ...partsOf(DELIVERING_HEALTH), notes: new Map() },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Delivering. Nothing is stuck.')).toBeVisible();
    await expect(canvas.queryAllByTestId('health-cause')).toHaveLength(0);
  },
};

export const DeliveringDark: Story = { args: { ...partsOf(DELIVERING_HEALTH), notes: new Map() }, globals: { theme: 'dark' } };

/** Nothing stuck and nothing acknowledged in the last 24 hours. */
export const Quiet: Story = {
  args: { ...partsOf(QUIET_HEALTH), notes: new Map() },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Nothing acknowledged in the last 24 h.')).toBeVisible();
  },
};

export const Loading: Story = { args: { stuck: LOADING, stuckPerHour: LOADING, acknowledged: LOADING } };

/** The stuck places are in, the trend is still read: the cause cards show, the verdict waits for its trend. */
export const TrendStillLoading: Story = {
  args: { stuckPerHour: LOADING },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByTestId('health-cause')).toHaveLength(4);
    await expect(canvas.queryByTestId('health-verdict')).toBeNull();
    await expect(canvas.getByText('Loading the verdict')).toBeInTheDocument();
  },
};

/** The acknowledged failed: the delivering line says so, the verdict and the causes stand. */
export const AcknowledgedFailed: Story = {
  args: { acknowledged: FAILED },
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getByTestId('health-verdict')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.acknowledged.onRetry).toHaveBeenCalled();
  },
};

/** The stuck places failed: said once, at the verdict; the delivering line stands. */
export const StuckFailed: Story = {
  args: { stuck: FAILED },
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getByTestId('health-delivering')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.stuck.onRetry).toHaveBeenCalled();
  },
};

export const Phone: Story = { args: { machines: MACHINES }, globals: { viewport: { value: 'mobile1' } } };

export const PhoneDark: Story = { args: { machines: MACHINES }, globals: { viewport: { value: 'mobile1' }, theme: 'dark' } };
