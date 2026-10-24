import type { StuckCause } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import { HEALTH_NOW, STUCK_HEALTH, STUCK_SUMMARY } from '../../../../lib/fixtures/health.fixtures';
import type { CauseTotal } from '../../services/health-view';
import { CauseCard, type CausePlacesRead } from './cause-card';

function totalOf(cause: StuckCause): CauseTotal {
  const total = STUCK_SUMMARY.byCause.find((each) => each.cause === cause);
  if (!total) {
    throw new Error(`No ${cause} in the fixture`);
  }
  return total;
}

/** A cause's places as read: every one on its first page. */
function readOf(cause: StuckCause, read: Partial<CausePlacesRead> = {}): CausePlacesRead {
  return {
    places: STUCK_HEALTH.stuck.filter((place) => place.cause === cause),
    isFailed: false,
    onRetry: fn(),
    hasMore: false,
    isLoadingMore: false,
    isLoadMoreFailed: false,
    onLoadMore: fn(),
    ...read,
  };
}

const meta = {
  title: 'Organisms/CauseCard',
  component: CauseCard,
  args: { total: totalOf('stalledInFlight'), read: readOf('stalledInFlight'), notes: new Map(), now: HEALTH_NOW },
  decorators: [(Story) => <div className="max-w-2xl">{Story()}</div>],
} satisfies Meta<typeof CauseCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two ships stalled: one opens its machine, the other its ship page. */
export const StalledInFlight: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByTestId('health-next-step').map((step) => step.textContent)).toEqual(['Open ship', 'Open machine']);
  },
};

/** A type no ship can take: the type as a chip, Commission as its step. */
export const NoShipCanTake: Story = { args: { total: totalOf('noShipCanTake'), read: readOf('noShipCanTake') } };

export const WaitingForCrew: Story = { args: { total: totalOf('waitingForCrew'), read: readOf('waitingForCrew') } };

export const Undeliverable: Story = { args: { total: totalOf('undeliverable'), read: readOf('undeliverable') } };

/** The count is in from the summary, the places still read: the shape of the places that come. */
export const PlacesLoading: Story = {
  args: { read: readOf('stalledInFlight', { places: undefined }) },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('health-places-loading')).toBeInTheDocument();
  },
};

/** The places failed: said in the card, its count stands, Try again reads them again. */
export const PlacesFailed: Story = {
  args: { read: readOf('stalledInFlight', { places: undefined, isFailed: true }) },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.read.onRetry).toHaveBeenCalled();
  },
};

/** More places follow the first page: Load more reads the next. */
export const MorePlaces: Story = {
  args: { read: readOf('stalledInFlight', { hasMore: true }) },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByTestId('health-places-load-more'));
    await expect(args.read.onLoadMore).toHaveBeenCalled();
  },
};

export const LoadingMorePlaces: Story = { args: { read: readOf('stalledInFlight', { hasMore: true, isLoadingMore: true }) } };

export const Dark: Story = { globals: { theme: 'dark' } };

export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
