import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import { BUILDER, HEALTH_NOW, SCOUT, STUCK_HEALTH, TESTER } from '../../../../lib/fixtures/health.fixtures';
import type { StuckPlace } from '../../services/health-view';
import { StuckDrilldown, type DrilldownMessage, type DrilldownShip } from './stuck-drilldown';

const PLANNER = { id: 'shp_01m50fadab99nv2shqvz0sf207', name: 'planner' };

function placesOf(cause: StuckPlace['cause']): StuckPlace[] {
  return STUCK_HEALTH.stuck.filter((place) => place.cause === cause);
}

const SHIPS = new Map<string, DrilldownShip>([
  [SCOUT.id, { status: 'crewed', type: 'scout', lastSeenAt: '2026-10-14T07:31:00.000Z' }],
  [BUILDER.id, { status: 'crewed', type: 'builder', lastSeenAt: '2026-10-16T10:54:00.000Z' }],
  [TESTER.id, { status: 'crewed', type: 'tester', lastSeenAt: '2026-10-16T11:30:00.000Z' }],
]);

const PREVIEWS = ['Scout the release branch.', 'Build pr-851.', 'Build pr-856.', 'Test pr-848 on the e2e fleet.'];

function messagesOf(places: readonly StuckPlace[]): ReadonlyMap<string, DrilldownMessage> {
  const deliveries = places.flatMap((place) => place.deliveries);
  return new Map(deliveries.map((delivery, index) => [delivery.messageId, { preview: PREVIEWS[index % PREVIEWS.length] ?? '', sender: PLANNER, isPing: false }]));
}

const STALLED = placesOf('stalledInFlight');
const UNDELIVERABLE = placesOf('undeliverable');

const meta = {
  title: 'Organisms/StuckDrilldown',
  component: StuckDrilldown,
  args: {
    cause: 'stalledInFlight',
    state: 'ready',
    places: STALLED,
    ships: SHIPS,
    messages: messagesOf(STALLED),
    onRetry: fn(),
    onResend: fn(),
    onDismiss: fn(),
    pendingIds: new Set(),
    now: HEALTH_NOW,
  },
} satisfies Meta<typeof StuckDrilldown>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Stalled in flight: scout-01 handed and quiet, builder-02 received on a silent machine. */
export const StalledInFlight: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByTestId('drilldown-place')).toHaveLength(2);
    await expect(canvas.getAllByTestId('drilldown-row')).toHaveLength(3);
  },
};

export const StalledInFlightDark: Story = { globals: { theme: 'dark' } };

/** Undeliverable: Resend and Dismiss on the row, no next step on the place. */
export const Undeliverable: Story = {
  args: { cause: 'undeliverable', places: UNDELIVERABLE, messages: messagesOf(UNDELIVERABLE) },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByTestId('drilldown-resend'));
    await expect(args.onResend).toHaveBeenCalled();
    await expect(canvas.queryByTestId('drilldown-next-step')).toBeNull();
  },
};

/** An undeliverable ping offers only Dismiss: a fresh one goes through Ping. */
export const UndeliverablePing: Story = {
  args: {
    cause: 'undeliverable',
    places: UNDELIVERABLE,
    messages: new Map([...messagesOf(UNDELIVERABLE)].map(([id, message]) => [id, { ...message, isPing: true, preview: 'Ping' }])),
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByTestId('drilldown-resend')).toBeNull();
    await expect(canvas.getByTestId('drilldown-dismiss')).toBeVisible();
  },
};

/** A viewer reads it: no Resend or Dismiss. */
export const ReadOnly: Story = { args: { cause: 'undeliverable', places: UNDELIVERABLE, messages: messagesOf(UNDELIVERABLE), onResend: undefined, onDismiss: undefined } };

/** A type no ship can take: the type, and Commission as its step. */
export const NoShipCanTake: Story = { args: { cause: 'noShipCanTake', places: placesOf('noShipCanTake'), messages: messagesOf(placesOf('noShipCanTake')) } };

/** The messages not read yet: each row still opens its message. */
export const MessagesLoading: Story = { args: { messages: new Map() } };

export const Empty: Story = { args: { places: [] } };

export const Loading: Story = { args: { state: 'loading' } };

export const LoadFailed: Story = { args: { state: 'error' } };

export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
