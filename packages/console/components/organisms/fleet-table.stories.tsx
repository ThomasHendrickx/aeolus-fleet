import { idSchema, type ListedShip } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Ellipsis, Plus } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { fn } from 'storybook/test';

import { DEFAULT_FLEET_VIEW, type FleetView } from '../../lib/fleet-filter';
import { Button } from '../atoms/button';
import { FleetTable, type RowActionsLayout } from './fleet-table';

const NOW = new Date('2026-09-28T14:30:00Z');
const HOUR_MS = 3_600_000;

function ship(suffix: string, changes: Partial<ListedShip> & Pick<ListedShip, 'name'>): ListedShip {
  return {
    id: idSchema('ship').parse(`shp_01m3tbfspe96yf1rnr4ank${suffix}`),
    type: 'builder',
    kind: 'agent',
    status: 'crewed',
    startingPrompt: {
      issuedAt: new Date(NOW.getTime() - 6 * HOUR_MS).toISOString(),
      isClaimed: true,
    },
    location: { kind: 'DEVICE', description: null },
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null,
    harness: 'claude-code',
    model: { id: 'claude-opus-5-5', statedAt: new Date(NOW.getTime() - 2 * 60_000).toISOString() },
    lastSeenAt: new Date(NOW.getTime() - 20_000).toISOString(),
    awaitingCrewSince: null,
    crewRequest: null,
    labels: {},
    retiredAt: null,
    ...changes,
  };
}

const argo = ship('h1aa', {
  name: 'argo',
  type: 'operator',
  kind: 'operator',
  startingPrompt: null,
  location: { kind: 'OTHER', description: 'web console' },
  ping: null,
  scopes: ['messages:send', 'messages:receive'],
  report: null,
  harness: null,
  model: null,
});

const FLEET: ListedShip[] = [
  argo,
  ship('h1ab', {
    name: 'builder-core',
    location: { kind: 'CLOUD', description: null },
    lastSeenAt: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null,
  }),
  ship('h1ac', {
    name: 'builder-web',
    status: 'awaitingCrew',
    location: null,
    lastSeenAt: null,
    harness: null,
    model: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null,
    startingPrompt: {
      issuedAt: new Date(NOW.getTime() - 3 * HOUR_MS).toISOString(),
      isClaimed: false,
    },
  }),
  ship('h1ad', { name: 'planner', type: 'planner' }),
  ship('h1ae', {
    name: 'release-captain',
    type: 'release',
    location: { kind: 'SERVER', description: null },
    lastSeenAt: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null,
  }),
  ship('h1af', {
    name: 'reviewer-01',
    type: 'reviewer',
    location: { kind: 'OTHER', description: 'CI runner' },
    lastSeenAt: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null,
  }),
  ship('h1ag', {
    name: 'triage-bot',
    type: 'triage',
    status: 'awaitingCrew',
    location: null,
    lastSeenAt: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null,
    startingPrompt: null,
  }),
  ship('h1ah', {
    name: 'old-scout',
    type: 'scout',
    status: 'retired',
    retiredAt: '2026-09-25T10:00:00.000Z',
    location: null,
    lastSeenAt: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null,
    startingPrompt: null,
  }),
];

function rowActions(listed: ListedShip, layout: RowActionsLayout) {
  if (layout === 'next') {
    return listed.status === 'awaitingCrew' ? <Button size="xs">Get starting prompt</Button> : null;
  }
  return <Button variant="ghost" size="xs" isIconOnly aria-label={`Actions for ${listed.name}`} icon={<Ellipsis />} />;
}

/** Keeps the view the way a page keeps it in the URL. */
function StatefulFleetTable({ view: initialView, ...props }: ComponentProps<typeof FleetTable>) {
  const [view, setView] = useState<FleetView>(initialView);
  return <FleetTable {...props} view={view} onViewChange={setView} />;
}

const meta = {
  title: 'Organisms/FleetTable',
  component: StatefulFleetTable,
  args: {
    ships: FLEET,
    view: DEFAULT_FLEET_VIEW,
    onViewChange: fn(),
    state: 'ready',
    now: NOW,
    renderRowActions: rowActions,
    emptyAction: (
      <Button variant="primary" icon={<Plus aria-hidden />}>
        Commission your first ship
      </Button>
    ),
  },
} satisfies Meta<typeof StatefulFleetTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NewShipHighlighted: Story = {
  args: { highlightedShipIds: new Set([FLEET[2]?.id ?? argo.id]) },
};

export const RetiredShown: Story = {
  args: {
    view: {
      ...DEFAULT_FLEET_VIEW,
      filters: { ...DEFAULT_FLEET_VIEW.filters, isRetiredShown: true },
    },
  },
};

export const NoResults: Story = {
  args: { view: { ...DEFAULT_FLEET_VIEW, query: 'deploy' } },
};

export const EmptyOnlyArgo: Story = { args: { ships: [argo] } };

export const Loading: Story = { args: { state: 'loading' } };

export const Error: Story = {
  args: {
    state: 'error',
    error: { detail: 'Request timed out after 10 s', onRetry: fn() },
  },
};

export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };

/** Phone with filters in force: the chips under the search, Clear filters, and the filter button marked. */
export const PhoneFiltered: Story = {
  globals: { viewport: { value: 'mobile1' } },
  args: { view: { ...DEFAULT_FLEET_VIEW, filters: { ...DEFAULT_FLEET_VIEW.filters, status: 'crewed', isRetiredShown: true } } },
};

/** Filters and a search with nothing left: one action clears both. */
export const NoResultsFiltered: Story = {
  args: { view: { query: 'deploy', filters: { ...DEFAULT_FLEET_VIEW.filters, status: 'awaitingCrew' } } },
};

/** Crewed ships with when each last called: one live, one whose session went quiet. */
export const LastSeen: Story = {
  args: {
    ships: [
      argo,
      ship('h1ba', { name: 'reviewer-01', type: 'reviewer', lastSeenAt: new Date(NOW.getTime() - 20_000).toISOString() }),
      ship('h1bb', { name: 'quiet-bot', type: 'triage', lastSeenAt: new Date(NOW.getTime() - 2 * HOUR_MS).toISOString() }),
    ],
  },
};

/** Crewed ships after argo pinged them: one waiting for an answer, one answered with pong, one acknowledged without pong. */
export const Pinged: Story = {
  args: {
    ships: [
      argo,
      ship('h1bc', {
        name: 'reviewer-01',
        lastSeenAt: new Date(NOW.getTime() - 20_000).toISOString(),
        ping: { state: 'answered', sentAt: new Date(NOW.getTime() - 60_000).toISOString(), answeredAt: new Date(NOW.getTime() - 56_000).toISOString() },
      }),
      ship('h1bd', {
        name: 'quiet-bot',
        lastSeenAt: new Date(NOW.getTime() - 2 * HOUR_MS).toISOString(),
        ping: { state: 'waiting', sentAt: new Date(NOW.getTime() - 3 * 60_000).toISOString(), answeredAt: null },
      }),
      ship('h1be', {
        name: 'old-bot',
        lastSeenAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
        ping: { state: 'received', sentAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(), answeredAt: null },
      }),
    ],
  },
};

/** Crewed ships whose crews reported: working on something, blocked, idle. */
export const Reported: Story = {
  args: {
    ships: [
      argo,
      ship('h1bf', {
        name: 'implementer-01',
        lastSeenAt: new Date(NOW.getTime() - 20_000).toISOString(),
        report: { state: 'working', note: 'on PR 89', reportedAt: new Date(NOW.getTime() - 2 * 60_000).toISOString(), detailsVersion: 0 },
      }),
      ship('h1bg', {
        name: 'tester-01',
        lastSeenAt: new Date(NOW.getTime() - 60_000).toISOString(),
        report: { state: 'blocked', note: 'waiting for implementer-01', reportedAt: new Date(NOW.getTime() - 9 * 60_000).toISOString(), detailsVersion: 0 },
      }),
      ship('h1bh', {
        name: 'planner-01',
        lastSeenAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
        report: { state: 'idle', note: null, reportedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(), detailsVersion: 0 },
      }),
    ],
  },
};

/** With squadrons on: the first ship as a flagship, the second as a member of its squadron. */
export const SquadronsOn: Story = {
  render: (args) => (
    <FleetTable
      {...args}
      squadronsOf={
        new Map([
          [args.ships[1]?.id ?? '', { squadronId: 'aeolus-a1b2c3', role: null }],
          [args.ships[2]?.id ?? '', { squadronId: 'aeolus-a1b2c3', role: 'implementer' }],
        ])
      }
    />
  ),
};
