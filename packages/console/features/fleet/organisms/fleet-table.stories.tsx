import { idSchema, type ListedShip } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Ellipsis, Plus } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { expect, fn, within } from 'storybook/test';

import { DEFAULT_FLEET_VIEW, type FleetView } from '../lib/fleet-filter';
import { Button } from '../../../components/atoms/button';
import { FleetTable, type RowActionsLayout } from './fleet-table';
import { AREA, BLUEPRINT, carried, COST, labelContext, OS, OWNERS, ownerShips, PROJECT } from '../../../lib/fixtures/labels.fixtures';

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
    labels: [],
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
  args: { ...Labels.args, view: { ...DEFAULT_FLEET_VIEW, filters: { ...DEFAULT_FLEET_VIEW.filters, labelValueIds: PICKED } } },
};

/** Label values no ship carries together: nothing left, one action clears them. */
export const LabelsNoMatch: Story = {
  args: { ...Labels.args, view: { ...DEFAULT_FLEET_VIEW, filters: { ...DEFAULT_FLEET_VIEW.filters, labelValueIds: [carried(PROJECT, 'website').valueId, carried(COST, 'high').valueId] } } },
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
  values: [{ id: idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ankh3ab'), value: SQUADRON_ID }],
};
const ROLE_LABEL = { ...COST, id: idSchema('label').parse('lbl_01m3tbfspe96yf1rnr4ankh3ac'), owner: OWNERS.squadrons, key: 'squadron-role', values: [{ id: idSchema('labelValue').parse('lbv_01m3tbfspe96yf1rnr4ankh3ad'), value: 'implementer' }] };
const IMPLEMENTER = ship('h2aa', {
  name: 'launch-implementer',
  harness: 'codex',
  model: { id: 'gpt-6.1-sol', statedAt: NOW.toISOString() },
  labels: [carried(SQUADRON_LABEL, SQUADRON_ID), carried(ROLE_LABEL, 'implementer'), carried(PROJECT, 'aeolus'), carried(OS, 'linux')],
  report: { state: 'working', note: 'Building the registry adapter', reportedAt: NOW.toISOString(), detailsVersion: 0 },
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
