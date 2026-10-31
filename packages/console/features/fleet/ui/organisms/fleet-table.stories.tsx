import { idSchema, type ListedShip } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Ellipsis, Plus } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { agentKindOf } from '../../services/agent-kind';
import { DEFAULT_FLEET_VIEW, type FleetView } from '../../services/fleet-filter';
import { Button } from '@aeolus-fleet/common/header';
import { FleetTable, type RowActionsLayout } from './fleet-table';
import { AREA, BLUEPRINT, carried, COST, labelContext, OS, OWNERS, ownerShips, PROJECT } from '../../../../lib/fixtures/labels.fixtures';
import { REPORT_TASKS, VIEWER_FLEET_ID } from '../../../../lib/fixtures/report.fixtures';

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
    activity: null, awaitingCrewSince: null,
    crewRequest: null,
    labels: [],
    retiredAt: null, ownerShipId: null,
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

/** The active ships of the story fleet: what `fleet.list` answers while Show retired is off. */
const ACTIVE_FLEET = FLEET.filter((listed) => listed.status !== 'retired');

/** Counts of a story fleet whose view selects `shown` ships. */
function countsOf(shown: readonly ListedShip[]) {
  return { shown: shown.length, total: FLEET.length, retired: FLEET.length - ACTIVE_FLEET.length };
}

/**
 * Keeps the view the way a page keeps it in the URL; with `rowsOf`, the rows
 * answer each view as the server would, so a story can pick and sort.
 */
function StatefulFleetTable({ view: initialView, rowsOf, ...props }: ComponentProps<typeof FleetTable> & { rowsOf?: (view: FleetView) => readonly ListedShip[] }) {
  const [view, setView] = useState<FleetView>(initialView);
  const rows = rowsOf?.(view) ?? props.ships;
  return <FleetTable {...props} ships={rows} counts={props.counts && { ...props.counts, shown: rows.length }} view={view} onViewChange={setView} />;
}

const meta = {
  title: 'Organisms/FleetTable',
  component: StatefulFleetTable,
  args: {
    viewerFleetId: VIEWER_FLEET_ID,
    ships: ACTIVE_FLEET,
    counts: countsOf(ACTIVE_FLEET),
    isOnlyArgo: false,
    types: [...new Set(FLEET.map((listed) => listed.type))].toSorted(),
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
    ships: FLEET,
    counts: countsOf(FLEET),
    view: {
      ...DEFAULT_FLEET_VIEW,
      filters: { ...DEFAULT_FLEET_VIEW.filters, isRetiredShown: true },
    },
  },
};

export const NoResults: Story = {
  args: { ships: [], counts: countsOf([]), view: { ...DEFAULT_FLEET_VIEW, query: 'deploy' } },
};

export const EmptyOnlyArgo: Story = { args: { ships: [argo], isOnlyArgo: true } };

/** More ships follow the pages loaded: Load more at the end of the list. */
export const MorePages: Story = {
  args: { more: { hasMore: true, isLoading: false, isFailed: false, onLoad: fn() } },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('fleet-load-more'));
    await expect(args.more?.onLoad).toHaveBeenCalledOnce();
  },
};

/** The next page on its way: Load more working, the rows shown kept. */
export const LoadingMore: Story = {
  args: { more: { hasMore: true, isLoading: true, isFailed: false, onLoad: fn() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('fleet-load-more')).toHaveTextContent('Loading more ships...');
    await expect(canvas.getByTestId('fleet-row-argo')).toBeVisible();
  },
};

/** The next page failed: what failed with Try again, the rows shown kept. */
export const LoadMoreFailed: Story = {
  args: { more: { hasMore: true, isLoading: false, isFailed: true, onLoad: fn() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Couldn’t load more ships')).toBeVisible();
    await expect(canvas.getByTestId('fleet-row-argo')).toBeVisible();
  },
};

/** Every ship the view selects is loaded: no Load more. */
export const LastPage: Story = {
  args: { more: { hasMore: false, isLoading: false, isFailed: false, onLoad: fn() } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('fleet-load-more')).toBeNull();
  },
};

export const Loading: Story = { args: { state: 'loading' } };

export const Error: Story = {
  args: {
    state: 'error',
    error: { detail: 'Request timed out after 10 s', onRetry: fn() },
  },
};

export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };

/** A Copilot session a trierarch crews: Runs on names Copilot with the coding agent's icon, beside Claude Code and Codex. */
const HARNESS_FLEET = [
  argo,
  ship('h4aa', { name: 'reviewer-01', report: { state: 'working', note: 'Reviewing PR 1388', task: null, step: null, reportedAt: NOW.toISOString(), reportChangedAt: NOW.toISOString(), detailsVersion: 0 } }),
  ship('h4ab', { name: 'builder-02', harness: 'codex', location: { kind: 'CLOUD', description: null }, model: { id: 'gpt-5.5-codex', statedAt: NOW.toISOString() } }),
  ship('h4ac', { name: 'docs-03', harness: 'copilot', model: { id: 'gpt-5.2', statedAt: NOW.toISOString() }, report: { state: 'working', note: 'Writing the Copilot guide', task: null, step: null, reportedAt: NOW.toISOString(), reportChangedAt: NOW.toISOString(), detailsVersion: 0 } }),
];
export const CopilotRunsOn: Story = {
  args: { ships: HARNESS_FLEET, labels: labelContext(HARNESS_FLEET) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByTitle('Copilot · Device')).not.toHaveLength(0);
  },
};
export const CopilotRunsOnPhone: Story = { ...CopilotRunsOn, globals: { viewport: { value: 'mobile1' } } };

/** The monitoring design's overview: each crewed ship's task per kind and step beside its note, the report's changed and reported times in its title. */
const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const PROGRESS_FLEET = [
  argo,
  ship('h5aa', { name: 'reviewer-3', report: { state: 'working', note: 'Reviewing the merge', task: REPORT_TASKS.pullRequest, step: { at: 3, of: 5 }, reportedAt: minutesBefore(1), reportChangedAt: minutesBefore(2), detailsVersion: 0 } }),
  ship('h5ab', { name: 'writer-2', report: { state: 'working', note: 'Drafting the guide', task: REPORT_TASKS.message, step: { at: 1, of: 4 }, reportedAt: minutesBefore(1), reportChangedAt: minutesBefore(6), detailsVersion: 0 } }),
  ship('h5ac', { name: 'triage', report: { state: 'idle', note: 'Nothing waiting', task: null, step: null, reportedAt: minutesBefore(4), reportChangedAt: minutesBefore(4), detailsVersion: 0 } }),
];
export const TaskAndStep: Story = {
  args: { ships: PROGRESS_FLEET, labels: labelContext(PROGRESS_FLEET) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('link', { name: 'PR #1391' })[0]).toHaveAttribute('href', REPORT_TASKS.pullRequest.url);
    await expect(within(canvasElement).getAllByText('a message')).not.toHaveLength(0);
  },
};
export const TaskAndStepPhone: Story = { ...TaskAndStep, globals: { viewport: { value: 'mobile1' } } };

/** The monitoring design's Seen cell: activity beside last seen, unknown once the trierarch's write is older than twice its interval, nothing for a ship crewed by hand. */
const ACTIVITY_FLEET = [
  argo,
  ship('h6aa', { name: 'reviewer-3', activity: { at: minutesBefore(2), kind: 'tool', tool: 'Bash', reportedAt: minutesBefore(0.2), intervalSeconds: 30 } }),
  ship('h6ab', { name: 'merger-1', activity: { at: minutesBefore(30), kind: 'tool', tool: 'Bash', reportedAt: minutesBefore(25), intervalSeconds: 30 } }),
  ship('h6ac', { name: 'writer-2', activity: { at: minutesBefore(1), kind: 'text', tool: null, reportedAt: minutesBefore(0.2), intervalSeconds: 30 } }),
  ship('h6ad', { name: 'triage' }),
];
export const Activity: Story = {
  args: { ships: ACTIVITY_FLEET, labels: labelContext(ACTIVITY_FLEET) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText('tool 2 min')).not.toHaveLength(0);
    await expect(within(canvasElement).getAllByText('unknown')).not.toHaveLength(0);
  },
};
export const ActivityPhone: Story = { ...Activity, globals: { viewport: { value: 'mobile1' } } };
export const ActivityDark: Story = { ...Activity, globals: { theme: 'dark' } };

/** Phone with filters in force: the chips under the search, Clear filters, and the filter button marked. */
export const PhoneFiltered: Story = {
  globals: { viewport: { value: 'mobile1' } },
  args: {
    ships: ACTIVE_FLEET.filter((listed) => listed.status === 'crewed'),
    counts: countsOf(ACTIVE_FLEET.filter((listed) => listed.status === 'crewed')),
    view: { ...DEFAULT_FLEET_VIEW, filters: { ...DEFAULT_FLEET_VIEW.filters, status: ['crewed'], isRetiredShown: true } },
  },
};

/** Filters and a search with nothing left: one action clears both. */
export const NoResultsFiltered: Story = {
  args: { ships: [], counts: countsOf([]), view: { ...DEFAULT_FLEET_VIEW, query: 'deploy', filters: { ...DEFAULT_FLEET_VIEW.filters, status: ['awaitingCrew'] } } },
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
        ping: { state: 'acknowledged', sentAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(), answeredAt: null },
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
        report: { state: 'working', note: 'on PR 89', task: null, step: null, reportedAt: new Date(NOW.getTime() - 2 * 60_000).toISOString(), reportChangedAt: new Date(NOW.getTime() - 2 * 60_000).toISOString(), detailsVersion: 0 },
      }),
      ship('h1bg', {
        name: 'tester-01',
        lastSeenAt: new Date(NOW.getTime() - 60_000).toISOString(),
        report: { state: 'blocked', note: 'waiting for implementer-01', task: null, step: null, reportedAt: new Date(NOW.getTime() - 9 * 60_000).toISOString(), reportChangedAt: new Date(NOW.getTime() - 9 * 60_000).toISOString(), detailsVersion: 0 },
      }),
      ship('h1bh', {
        name: 'planner-01',
        lastSeenAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
        report: { state: 'idle', note: null, task: null, step: null, reportedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(), reportChangedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(), detailsVersion: 0 },
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

/** What each story ship carries, by name (canvas Labels, LbOverview). */
const CARRIED: Readonly<Record<string, ListedShip['labels']>> = {
  'builder-core': [carried(PROJECT, 'aeolus'), carried(AREA, 'backend'), carried(OS, 'macos'), carried(BLUEPRINT, 'aeolus-review')],
  'builder-web': [carried(PROJECT, 'hemma'), carried(AREA, 'frontend')],
  planner: [carried(PROJECT, 'hemma')],
  'release-captain': [carried(COST, 'low')],
  'reviewer-01': [carried(PROJECT, 'aeolus'), carried(AREA, 'review'), carried(OS, 'linux')],
};
const LABELLED_FLEET: ListedShip[] = [...FLEET.map((listed) => ({ ...listed, labels: CARRIED[listed.name] ?? [] })), ...ownerShips(argo)];
const PICKED = [carried(PROJECT, 'hemma').valueId, carried(AREA, 'frontend').valueId];

/** With labels (#102): a second line of chips under each name, yours unmarked, then "+n"; the Labels filter in the toolbar. */
export const Labels: Story = { args: { ships: LABELLED_FLEET, labels: labelContext(LABELLED_FLEET) } };

/** Two label values picked: "Ships with project=hemma and area=frontend", each with ×, Add and Clear labels. */
export const LabelsFiltered: Story = {
  args: {
    ...Labels.args,
    ships: LABELLED_FLEET.filter((listed) => PICKED.every((valueId) => listed.labels.some((label) => label.valueId === valueId))),
    view: { ...DEFAULT_FLEET_VIEW, filters: { ...DEFAULT_FLEET_VIEW.filters, labelValueIds: PICKED } },
  },
};

/** Label values no ship carries together: nothing left, one action clears them. */
export const LabelsNoMatch: Story = {
  args: { ...Labels.args, ships: [], counts: countsOf([]), view: { ...DEFAULT_FLEET_VIEW, filters: { ...DEFAULT_FLEET_VIEW.filters, labelValueIds: [carried(PROJECT, 'website').valueId, carried(COST, 'high').valueId] } } },
};

/** A viewer: every label marked by its owner, argo's too; the filter works the same. */
export const LabelsViewer: Story = { args: { ships: LABELLED_FLEET, labels: labelContext(LABELLED_FLEET, false) } };

/** Phone with labels picked: no chips on rows (Q3), the values picked as chips under the search. */
export const PhoneLabelsFiltered: Story = { ...LabelsFiltered, globals: { viewport: { value: 'mobile1' } } };

/** The ships the console's plugins run as, squadrons' and the trierarch plugin's, each with a plugin chip (#368). */
export const PluginShips: Story = {
  args: { ships: [...FLEET, ...ownerShips(argo)], pluginShipIds: new Set(ownerShips(argo).map((each) => each.id)) },
};

/** A real-sized fleet: membership and labels must never compete with the ship name. */
const SQUADRON_ID = 'launch-a1b2';
const SQUADRON_LABEL = {
  ...BLUEPRINT,
  id: idSchema('label').parse('lbl_01m3tbfspe96yf1rnr4ankh3aa'),
  owner: OWNERS.squadrons,
  key: 'squadron',
  shipCount: 1,
  values: [{ id: idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ankh3ab'), value: SQUADRON_ID, shipCount: 1 }],
};
const ROLE_LABEL = { ...COST, id: idSchema('label').parse('lbl_01m3tbfspe96yf1rnr4ankh3ac'), owner: OWNERS.squadrons, key: 'squadron-role', shipCount: 1, values: [{ id: idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ankh3ad'), value: 'implementer', shipCount: 1 }] };
const IMPLEMENTER = ship('h2aa', {
  name: 'launch-implementer',
  harness: 'codex',
  model: { id: 'gpt-6.1-sol', statedAt: NOW.toISOString() },
  labels: [carried(SQUADRON_LABEL, SQUADRON_ID), carried(ROLE_LABEL, 'implementer'), carried(PROJECT, 'aeolus'), carried(OS, 'linux')],
  report: { state: 'working', note: 'Building the registry adapter', task: null, step: null, reportedAt: NOW.toISOString(), reportChangedAt: NOW.toISOString(), detailsVersion: 0 },
});
const CLEAN_FLEET = [argo, IMPLEMENTER, ship('h2ab', { name: 'harbour-ios', model: null }), ship('h2ac', { name: 'trierarch-plugin', harness: 'node', location: { kind: 'SERVER', description: 'fleet server' }, model: { id: '@aeolus-fleet/trierarch-plugin@0.24.0', statedAt: NOW.toISOString() } }), FLEET[2] ?? argo, FLEET[7] ?? argo];
const CLEAN_ARGS = {
  ships: CLEAN_FLEET,
  labels: { ...labelContext(CLEAN_FLEET), ownerOf: new Map([...labelContext(CLEAN_FLEET).ownerOf, [SQUADRON_LABEL.id, { name: OWNERS.squadrons.name, mark: 'squadrons', isYours: false }], [ROLE_LABEL.id, { name: OWNERS.squadrons.name, mark: 'squadrons', isYours: false }]]), labels: [...labelContext(CLEAN_FLEET).labels, SQUADRON_LABEL, ROLE_LABEL] },
  squadronsOf: new Map([[IMPLEMENTER.id, { squadronId: SQUADRON_ID, role: 'implementer' }]]),
  view: { ...DEFAULT_FLEET_VIEW, filters: { ...DEFAULT_FLEET_VIEW.filters, isRetiredShown: true } },
};

export const CleanOverview: Story = {
  args: CLEAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByRole('table', { name: 'Ships' });
    const headings = within(table).getAllByRole('columnheader').map((heading) => heading.textContent);
    await expect(headings).toEqual(['Ship', 'Status', 'Report', 'Squadron and labels', 'Runs on', 'Seen', 'Actions']);
    const row = canvas.getByTestId('fleet-row-launch-implementer');
    const cells = within(row).getAllByRole('cell');
    await expect(cells[0]).toHaveTextContent('launch-implementer');
    await expect(cells[0]).not.toHaveTextContent(SQUADRON_ID);
    await expect(cells[3]).toHaveTextContent(SQUADRON_ID);
    await expect(cells[3]).not.toHaveTextContent('squadron=');
    await expect(cells[3]).not.toHaveTextContent('squadron-role=');
    await expect(within(cells[3] ?? row).getByRole('link', { name: SQUADRON_ID }).parentElement).toHaveAttribute('title', `${SQUADRON_ID} · implementer`);
    await expect(cells[4]).toHaveTextContent('Codex');
    await expect(cells[4]).toHaveTextContent('gpt-6.1-sol');
    await expect(row.getBoundingClientRect().height).toBe(48);
    const software = canvas.getByTestId('fleet-row-trierarch-plugin');
    await expect(within(software).getAllByRole('cell')[4]).toHaveTextContent('@aeolus-fleet/trierarch-plugin@0.24.0');
    await expect(within(row).getByRole('link', { name: 'View 2 more labels' })).toHaveAttribute('href', `/ships/${IMPLEMENTER.id}`);
    await expect(within(row).getByRole('link', { name: 'launch-implementer' }).scrollWidth).toBeLessThanOrEqual(within(row).getByRole('link', { name: 'launch-implementer' }).clientWidth);
    await expect(within(table).queryByText('Not stated yet')).not.toBeInTheDocument();
    await expect(within(canvas.getByTestId('fleet-row-builder-web')).queryByText(/Prompt issued/)).not.toBeInTheDocument();
    await expect(within(canvas.getByTestId('fleet-row-old-scout')).queryByText(/Retired \d/)).not.toBeInTheDocument();
  },
};

export const CleanOverviewDark: Story = { ...CleanOverview, globals: { theme: 'dark' } };

export const CleanOverviewPhone: Story = {
  args: CLEAN_ARGS,
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('fleet-card-launch-implementer');
    const name = within(row).getByRole('link', { name: 'launch-implementer' });
    const membership = within(row).getByRole('link', { name: SQUADRON_ID });
    await expect(membership.getBoundingClientRect().top).toBeGreaterThan(name.getBoundingClientRect().bottom);
    await expect(within(row).getByTestId('fleet-model-hint')).toHaveTextContent('gpt-6.1-sol');
    await expect(within(row).queryByText(/squadron=/)).not.toBeInTheDocument();
    await expect(within(canvas.getByTestId('fleet-card-builder-web')).queryByText(/Prompt issued/)).not.toBeInTheDocument();
    await expect(within(canvas.getByTestId('fleet-card-harbour-ios')).queryByText('Not stated yet')).not.toBeInTheDocument();
  },
};

export const CleanOverviewPhoneDark: Story = { ...CleanOverviewPhone, globals: { ...CleanOverviewPhone.globals, theme: 'dark' } };


/** Report states stay separate from registry status, with the same one-line density. */
export const ReportStates: Story = {
  ...Reported,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const [name, state] of [['implementer-01', 'working'], ['tester-01', 'blocked'], ['planner-01', 'idle']]) {
      const row = canvas.getByTestId(`fleet-row-${name}`);
      await expect(within(row).getByTestId('fleet-report')).toHaveAttribute('data-state', state);
      await expect(within(row).getByText('Crewed')).toBeVisible();
      await expect(row.getBoundingClientRect().height).toBe(48);
    }
  },
};

/** Long handles wrap on phone without metadata sharing their line. */
export const LongNamePhone: Story = {
  args: { ships: [argo, ship('h2ad', { name: 'launch-reviewer-with-a-long-ship-name-for-the-fleet' })] },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('fleet-card-launch-reviewer-with-a-long-ship-name-for-the-fleet');
    const name = within(row).getByRole('link', { name: 'launch-reviewer-with-a-long-ship-name-for-the-fleet' });
    await expect(getComputedStyle(name).whiteSpace).toBe('normal');
    await expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
  },
};


/** Only members carry SquadronTag; a flagship keeps its existing kind and actions. */
export const FlagshipAndMember: Story = {
  ...SquadronsOn,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const flagship = canvas.getByTestId('fleet-row-builder-core');
    const member = canvas.getByTestId('fleet-row-builder-web');
    await expect(within(flagship).getByTestId('fleet-flagship')).toBeVisible();
    await expect(flagship.querySelector('[data-slot="squadron-tag"]')).toBeNull();
    await expect(member.querySelectorAll('[data-slot="squadron-tag"]').length).toBe(1);
  },
};

/** The page renders an action component even when that component has no next step. */
function NoNextStep() {
  return null;
}

export const ReportWithEmptyNextStep: Story = {
  ...Reported,
  args: { ...Reported.args, renderRowActions: (listed, layout) => layout === 'next' ? <NoNextStep /> : rowActions(listed, layout) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(within(canvas.getByTestId('fleet-row-implementer-01')).getByTestId('fleet-report')).toBeVisible();
  },
};

/** One ship of every kind (#401): the console's two, a plugin's, a machine's trierarch, Claude Code, Codex, and a ship no session crews. */
const PLUGIN_SHIP = ship('h3aa', { name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'plugin', harness: 'node', location: { kind: 'SERVER', description: 'fleet server' }, model: null, report: { state: 'idle', note: 'All crew requests assigned', task: null, step: null, reportedAt: NOW.toISOString(), reportChangedAt: NOW.toISOString(), detailsVersion: 0 } });
const KIND_FLEET = [
  argo,
  ship('h3ab', { name: 'viewer', type: 'viewer', kind: 'viewer', harness: null, model: null }),
  PLUGIN_SHIP,
  ship('h3ac', { name: 'trierarch-mac', type: 'trierarch', harness: 'aeolus-trierarch', model: null }),
  ship('h3ad', { name: 'harbour-ios', report: { state: 'working', note: 'Writing the login screen', task: null, step: null, reportedAt: NOW.toISOString(), reportChangedAt: NOW.toISOString(), detailsVersion: 0 } }),
  IMPLEMENTER,
  FLEET[2] ?? argo,
];
const KIND_PLUGINS: ReadonlySet<string> = new Set([PLUGIN_SHIP.id]);

/** The story's report sort reads the note, a ship without one last either way. */
function reportNoteOf(listed: ListedShip): string | undefined {
  return listed.report?.note ?? undefined;
}

/** The kind fleet as the server answers a view: the kinds picked, sorted by ship or report; otherwise argo first and then by name, as the stories need no more. */
function kindRowsOf(view: FleetView): ListedShip[] {
  const picked = KIND_FLEET.filter((listed) => view.filters.kind.length === 0 || view.filters.kind.includes(agentKindOf(listed, KIND_PLUGINS)));
  const sign = view.sort?.direction === 'descending' ? -1 : 1;
  switch (view.sort?.column) {
    case 'ship':
      return picked.toSorted((first, second) => sign * first.name.localeCompare(second.name));
    case 'report':
      return picked.toSorted((first, second) => {
        const [one, other] = [reportNoteOf(first), reportNoteOf(second)];
        return one === undefined || other === undefined ? Number(one === undefined) - Number(other === undefined) : sign * one.localeCompare(other);
      });
    case 'status':
    case 'runsOn':
    case 'seen':
    case undefined:
      return picked.toSorted((first, second) => Number(second.kind === 'operator') - Number(first.kind === 'operator') || first.name.localeCompare(second.name));
  }
}

const KIND_ARGS = { ships: KIND_FLEET, rowsOf: kindRowsOf, pluginShipIds: KIND_PLUGINS };

/** The Kind filter on Codex: only the ships whose session runs in Codex. */
export const KindFiltered: Story = {
  args: { ...KIND_ARGS, view: { ...DEFAULT_FLEET_VIEW, filters: { ...DEFAULT_FLEET_VIEW.filters, kind: ['codex'] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('fleet-filter-kind')).toHaveTextContent('Codex');
    await expect(within(canvas.getByRole('table', { name: 'Ships' })).getAllByRole('row')).toHaveLength(2);
    await expect(canvas.getByTestId('fleet-row-launch-implementer')).toBeVisible();
  },
};

export const KindFilteredDark: Story = { ...KindFiltered, globals: { theme: 'dark' } };

/** The phone's filter Sheet with Kind on Plugin: its chips beside the other filters, and the filter in force as a chip. */
export const PhoneKindFilter: Story = {
  args: { ...KIND_ARGS, view: { ...DEFAULT_FLEET_VIEW, filters: { ...DEFAULT_FLEET_VIEW.filters, kind: ['plugin'] } } },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('fleet-filter-chips')).toHaveTextContent('Kind: Plugin');
    await userEvent.click(canvas.getByTestId('fleet-filters-open'));
    const sheet = within(canvasElement.ownerDocument.body);
    const kinds = sheet.getByRole('group', { name: 'Kind' });
    await expect(within(kinds).getAllByRole('button').map((option) => option.textContent)).toEqual(['All', 'Console', 'Claude Code', 'Codex', 'Trierarch', 'Plugin', 'Other']);
    await expect(within(kinds).getByRole('button', { name: 'Plugin' })).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByTestId('fleet-filters-apply')).toHaveTextContent('Show 1 ship');
  },
};

export const PhoneKindFilterDark: Story = { ...PhoneKindFilter, globals: { ...PhoneKindFilter.globals, theme: 'dark' } };

const CLAUDE_CODE_AND_CODEX: FleetView = { ...DEFAULT_FLEET_VIEW, filters: { ...DEFAULT_FLEET_VIEW.filters, kind: ['claudeCode', 'codex'] } };

/** The Kind filter on Claude Code and Codex (#815): the ships of either, the trigger counting the two picked. */
export const KindSeveralPicked: Story = {
  args: { ...KIND_ARGS, view: CLAUDE_CODE_AND_CODEX },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('fleet-filter-kind')).toHaveTextContent('Kind2 picked');
    await expect(canvas.getByTestId('fleet-row-launch-implementer')).toBeVisible();
    await expect(canvas.getByTestId('fleet-row-harbour-ios')).toBeVisible();
    await expect(canvas.queryByTestId('fleet-row-trierarch-mac')).toBeNull();
    await expect(canvas.queryByTestId('fleet-row-argo')).toBeNull();
  },
};

export const KindSeveralPickedDark: Story = { ...KindSeveralPicked, globals: { theme: 'dark' } };

/** The Kind filter open with Claude Code and Codex picked: both checked, All not; picking Trierarch adds it and keeps the list open. */
export const KindSeveralPickedOpen: Story = {
  args: { ...KIND_ARGS, view: CLAUDE_CODE_AND_CODEX },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByTestId('fleet-filter-kind'));
    await expect(await page.findByRole('option', { name: 'Claude Code' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', { name: 'Codex' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', { name: 'All' })).toHaveAttribute('aria-selected', 'false');
    await userEvent.click(page.getByRole('option', { name: 'Trierarch' }));
    await expect(page.getByRole('option', { name: 'Trierarch' })).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByTestId('fleet-filter-kind')).toHaveTextContent('Kind3 picked');
    await expect(canvas.getByTestId('fleet-row-trierarch-mac')).toBeVisible();
  },
};

/** One value picked: the trigger names it. Picking All in the open list takes every value out. */
export const KindOnePickedThenAll: Story = {
  args: { ...KIND_ARGS, view: { ...DEFAULT_FLEET_VIEW, filters: { ...DEFAULT_FLEET_VIEW.filters, kind: ['trierarch'] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByTestId('fleet-filter-kind')).toHaveTextContent('KindTrierarch');
    await userEvent.click(canvas.getByTestId('fleet-filter-kind'));
    await userEvent.click(await page.findByRole('option', { name: 'All' }));
    await expect(canvas.getByTestId('fleet-filter-kind')).toHaveTextContent('KindAll');
    await expect(canvas.getByTestId('fleet-row-argo')).toBeVisible();
  },
};

/** The phone's Sheet with Claude Code and Codex picked: both chips on, All off, and the filter as one chip naming both. */
export const PhoneKindSeveralPicked: Story = {
  args: { ...KIND_ARGS, view: CLAUDE_CODE_AND_CODEX },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('fleet-filter-chips')).toHaveTextContent('Kind: Claude Code, Codex');
    await userEvent.click(canvas.getByTestId('fleet-filters-open'));
    const kinds = within(within(canvasElement.ownerDocument.body).getByRole('group', { name: 'Kind' }));
    await expect(kinds.getByRole('button', { name: 'Claude Code' })).toHaveAttribute('aria-pressed', 'true');
    await expect(kinds.getByRole('button', { name: 'Codex' })).toHaveAttribute('aria-pressed', 'true');
    await expect(kinds.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  },
};

export const PhoneKindSeveralPickedDark: Story = { ...PhoneKindSeveralPicked, globals: { ...PhoneKindSeveralPicked.globals, theme: 'dark' } };

function shownNames(canvasElement: HTMLElement): string[] {
  return within(within(canvasElement).getByRole('table', { name: 'Ships' }))
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.dataset.testid?.replace('fleet-row-', '') ?? '');
}

/** No column sorted: argo first, then by name, every header but Squadron and labels offering to sort. */
export const Unsorted: Story = {
  args: KIND_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(shownNames(canvasElement)[0]).toBe('argo');
    const headers = within(canvas.getByRole('table', { name: 'Ships' })).getAllByRole('columnheader').slice(0, 6);
    await expect(headers.map((header) => header.getAttribute('aria-sort'))).toEqual(['none', 'none', 'none', null, 'none', 'none']);
  },
};

export const UnsortedDark: Story = { ...Unsorted, globals: { theme: 'dark' } };

/** Sorted by Ship, A to Z: argo among the rest; a keyboard press on the header turns it Z to A. */
export const SortedAscending: Story = {
  args: { ...KIND_ARGS, view: { ...DEFAULT_FLEET_VIEW, sort: { column: 'ship', direction: 'ascending' } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('fleet-sort-ship')).toHaveAttribute('aria-sort', 'ascending');
    await expect(shownNames(canvasElement)).toEqual(['argo', 'builder-web', 'harbour-ios', 'launch-implementer', 'trierarch-mac', 'trierarch-plugin', 'viewer']);
    within(canvas.getByTestId('fleet-sort-ship')).getByRole('button').focus();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.getByTestId('fleet-sort-ship')).toHaveAttribute('aria-sort', 'descending');
    await expect(shownNames(canvasElement)[0]).toBe('viewer');
  },
};

export const SortedAscendingDark: Story = { ...SortedAscending, globals: { theme: 'dark' } };

/** Sorted by Report, Z to A: ships without a report stay last; a third click puts the default order back. */
export const SortedDescending: Story = {
  args: { ...KIND_ARGS, view: { ...DEFAULT_FLEET_VIEW, sort: { column: 'report', direction: 'descending' } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('fleet-sort-report')).toHaveAttribute('aria-sort', 'descending');
    await expect(shownNames(canvasElement).slice(0, 2)).toEqual(['harbour-ios', 'launch-implementer']);
    await userEvent.click(within(canvas.getByTestId('fleet-sort-report')).getByRole('button'));
    await expect(canvas.getByTestId('fleet-sort-report')).toHaveAttribute('aria-sort', 'none');
    await expect(shownNames(canvasElement)[0]).toBe('argo');
  },
};

export const SortedDescendingDark: Story = { ...SortedDescending, globals: { theme: 'dark' } };

/** A plugin ship reports what it does (decision 0050): its report shows in the Report cell, as an agent ship's does. */
export const PluginShipReport: Story = {
  args: KIND_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(within(canvas.getByTestId('fleet-row-trierarch-plugin')).getByTestId('fleet-report')).toHaveTextContent('All crew requests assigned');
  },
};

const NO_HARNESS = ship('h6aa', { name: 'lookout', harness: null, location: { kind: 'DEVICE', description: 'thomas-linux' } });

/** A crewed agent ship whose session stated no harness (aeolus-fleet#1408): Harness unknown, a fault, beside its location with the machine name; argo stays the console. */
export const HarnessUnknown: Story = {
  args: { ships: [argo, NO_HARNESS], counts: countsOf([argo, NO_HARNESS]) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const runsOn = within(canvas.getByTestId('fleet-row-lookout')).getByTestId('fleet-runs-on');
    await expect(within(runsOn).getByTestId('harness-unknown')).toHaveTextContent('Harness unknown');
    await expect(within(runsOn).getByTestId('harness-unknown')).toHaveAttribute('title', 'The session stated no harness: a fault in Aeolus');
    await expect(runsOn).toHaveTextContent('thomas-linux');
    await expect(within(canvas.getByTestId('fleet-row-argo')).queryByTestId('harness-unknown')).toBeNull();
  },
};
