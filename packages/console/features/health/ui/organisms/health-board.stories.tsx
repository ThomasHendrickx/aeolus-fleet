import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import type { Health, StuckCause, StuckSummary } from '@aeolus-fleet/common';

import { DELIVERING_HEALTH, DELIVERING_SUMMARY, HEALTH_NOW, HETZNER, QUIET_HEALTH, STUCK_HEALTH, STUCK_SUMMARY } from '../../../../lib/fixtures/health.fixtures';
import { placeNote, type StuckPlace } from '../../services/health-view';
import type { CausePlacesRead } from './cause-card';
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

/** A cause's places as read: every one on its first page. */
function placesOf(health: Health, cause: StuckCause): CausePlacesRead {
  return {
    places: health.stuck.filter((place) => place.cause === cause),
    isFailed: false,
    onRetry: fn(),
    hasMore: false,
    isLoadingMore: false,
    isLoadMoreFailed: false,
    onLoadMore: fn(),
  };
}

/** Each part of a health as read, each by its own read. */
function partsOf(health: Health, summary: StuckSummary) {
  return {
    summary: read(summary),
    places: {
      noShipCanTake: placesOf(health, 'noShipCanTake'),
      waitingForCrew: placesOf(health, 'waitingForCrew'),
      stalledInFlight: placesOf(health, 'stalledInFlight'),
      undeliverable: placesOf(health, 'undeliverable'),
    },
    stuckPerHour: read(health.stuckPerHour),
    acknowledged: read(health.acknowledged),
  };
}

const meta = {
  title: 'Organisms/HealthBoard',
  component: HealthBoard,
  args: {
    ...partsOf(STUCK_HEALTH, STUCK_SUMMARY),
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
  args: { ...partsOf(DELIVERING_HEALTH, DELIVERING_SUMMARY), notes: new Map() },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Delivering. Nothing is stuck.')).toBeVisible();
    await expect(canvas.queryAllByTestId('health-cause')).toHaveLength(0);
  },
};

export const DeliveringDark: Story = { args: { ...partsOf(DELIVERING_HEALTH, DELIVERING_SUMMARY), notes: new Map() }, globals: { theme: 'dark' } };

/** Nothing stuck and nothing acknowledged in the last 24 hours. */
export const Quiet: Story = {
  args: { ...partsOf(QUIET_HEALTH, DELIVERING_SUMMARY), notes: new Map() },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Nothing acknowledged in the last 24 h.')).toBeVisible();
  },
};

export const Loading: Story = { args: { summary: LOADING, stuckPerHour: LOADING, acknowledged: LOADING } };

/** The stuck summary is in, the trend is still read: the cause cards show, the verdict waits for its trend. */
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

/** One cause's places are still read: its card shows its count and the shape of its places, the others stand. */
export const PlacesStillLoading: Story = {
  args: { places: { ...partsOf(STUCK_HEALTH, STUCK_SUMMARY).places, stalledInFlight: { ...placesOf(STUCK_HEALTH, 'stalledInFlight'), places: undefined } } },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('health-verdict')).toBeVisible();
    await expect(canvas.getAllByTestId('health-cause')).toHaveLength(4);
    await expect(canvas.getByTestId('health-places-loading')).toBeInTheDocument();
  },
};

/** The stuck summary failed: said once, at the verdict; the delivering line stands. */
export const StuckFailed: Story = {
  args: { summary: FAILED },
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getByTestId('health-delivering')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.summary.onRetry).toHaveBeenCalled();
  },
};

export const Phone: Story = { args: { machines: MACHINES }, globals: { viewport: { value: 'mobile1' } } };

export const PhoneDark: Story = { args: { machines: MACHINES }, globals: { viewport: { value: 'mobile1' }, theme: 'dark' } };
