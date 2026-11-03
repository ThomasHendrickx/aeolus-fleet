import type { Meta, StoryObj } from '@storybook/react-vite';
import { Ship } from 'lucide-react';
import { expect, fn, userEvent, within } from 'storybook/test';

import type { HarbourTileShip } from '../molecules/harbour-tile.js';
import { Harbour, type HarbourGroupShips } from './harbour.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

/** A tile by its name, and its state, note and minutes since it last did something (null: never). */
function aTile(name: string, [state, note, minutes]: [HarbourTileShip['state'], string | null, number | null]): HarbourTileShip {
  return { id: `shp_${name}`, name, state, note, lastActivityAt: minutes === null ? null : minutesAgo(minutes) };
}

const HOUR = 60;
const DAY = 24 * HOUR;

/** The approved mockups' fleet (docs/design/fleet-overview): 19 ships, today 3 Nov. */
const FLEET: HarbourGroupShips[] = [
  {
    kind: 'people',
    tiles: [aTile('thomas', ['awaitingCrew', '4 wait on you', 12]), aTile('argo', ['idle', 'Nothing open', 3 * HOUR]), aTile('thomas-hendrickx1989', ['idle', 'Signed in, nothing open', DAY + HOUR])],
  },
  {
    kind: 'agents',
    tiles: [
      aTile('ecosystem-relationships', ['alert', 'No report change for 2 h', 2 * HOUR]),
      aTile('walker-3', ['awaitingCrew', 'Awaiting crew', null]),
      aTile('builder-gateway', ['blocked', 'Blocked: waiting for release 0.37.0', 25]),
      aTile('orchestrator-1', ['working', 'Cutting #189 into slices', 0]),
      aTile('mac-mini', ['working', 'Running the nightly backup check', 1]),
      aTile('host-agent-1', ['working', 'Answering a question from attio', 3]),
      aTile('aeolus-fleet-infra', ['working', 'Rolling out core 0.37.0 to staging', 4]),
      aTile('design-bridge-fleet', ['working', 'Mockups for #189', 0]),
      aTile('agent-host-1-box', ['idle', 'Done: rotated the logs', 2 * HOUR]),
      aTile('infra-mac-mini', ['idle', 'Done: disk cleanup', 2 * DAY]),
      aTile('aeolus-guide', ['idle', 'Nothing open', 6 * DAY + 12 * HOUR + DAY]),
    ],
  },
  {
    kind: 'plugins',
    tiles: [aTile('trierarch-plugin', ['working', 'Watching 12 sessions', 0]), aTile('squadrons', ['working', 'design-sq: 3 on station', 1]), aTile('gateway', ['working', 'Crewing 2 outside parties', 0])],
  },
  { kind: 'gateway', tiles: [aTile('company-memory', ['idle', 'Last call: search', 40]), aTile('attio', ['idle', 'Last call: list contacts', 3 * HOUR])] },
];

const COUNTS = { ships: 19, alert: 1, awaitingCrew: 2, blocked: 1, working: 8, idle: 7 };

/** Harbour at a width, as an app's page or column gives it. */
function widthOf(className: string) {
  return (Story: () => React.JSX.Element) => (
    <div className={className}>
      <Story />
    </div>
  );
}

const meta = {
  title: 'Harbour/Harbour',
  component: Harbour,
  args: { counts: COUNTS, groups: FLEET, now: NOW, hrefOf: (shipId) => `#${shipId}`, state: 'ready', onRetry: fn() },
  decorators: [widthOf('w-284')],
} satisfies Meta<typeof Harbour>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The console at 1440: large numbers, four tiles a row. */
export const Console1440: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByTestId('harbour-tile')).toHaveLength(19);
  },
};

/** The console at 1920: seven tiles a row. */
export const Console1920: Story = { decorators: [widthOf('w-404')] };

/** Bridge's column at 1440: small numbers, one tile a row; no bar between. */
export const BridgeColumn1440: Story = { decorators: [widthOf('w-102')] };

/** Bridge's column at 1920: three tiles a row. */
export const BridgeColumn1920: Story = { decorators: [widthOf('w-222')] };

/** A phone: small numbers in one row of five, two tiles a row. */
export const Phone: Story = { decorators: [widthOf('w-86')] };

/** What the app puts between the numbers and the groups: the console's filter bar. */
export const WithBetween: Story = {
  args: { between: <div className="rounded-md border border-dashed border-border p-2 text-meta text-muted-foreground">The app’s filter bar</div> },
};

/** A new result is coming: the previous groups, dimmed. */
export const Updating: Story = {
  args: { isUpdating: true, groups: FLEET.slice(0, 2) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('harbour-groups')).toHaveAttribute('aria-busy', 'true');
  },
};

/** No groups: what the app gives stands in for them, such as no match or argo alone. */
export const Empty: Story = {
  args: {
    groups: [],
    empty: (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
        <Ship aria-hidden className="size-6 text-muted-foreground" />
        <p className="text-heading font-semibold">No ships match these filters.</p>
      </div>
    ),
  },
};

/** argo alone: one group, one tile. */
export const ArgoAlone: Story = {
  args: { counts: { ships: 1, alert: 0, awaitingCrew: 0, blocked: 0, working: 0, idle: 1 }, groups: [{ kind: 'people', tiles: [aTile('argo', ['idle', 'Nothing open', 3 * HOUR])] }] },
};

/** While the fleet is read: the shape that is coming. */
export const Loading: Story = {
  args: { counts: undefined, groups: undefined, state: 'loading' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('harbour-loading')).toBeInTheDocument();
  },
};

/** Tiles that are not links, when the app gives no page. */
export const WithoutLinks: Story = {
  args: { hrefOf: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryAllByRole('link')).toHaveLength(0);
  },
};

/** The read failed: what went wrong, and Try again asks the app to read again. */
export const Failed: Story = {
  args: { counts: undefined, groups: undefined, state: 'error', errorDetail: 'Request timed out after 10 s' },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};
