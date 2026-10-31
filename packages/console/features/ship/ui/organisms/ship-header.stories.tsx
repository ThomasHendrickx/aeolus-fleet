import { idSchema, SHIP_LABELS_MAX } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { KeyRound } from 'lucide-react';
import { expect, fn, within } from 'storybook/test';

import { SQUADRONS_SHIP } from '../../../../lib/connect-plugin';
import { assignKeysOf, chipsOf, labelLimitOf } from '../../../../lib/labels';
import { Button } from '@aeolus-fleet/common/header';
import { ShipLabels } from '../../../../components/molecules/ship-labels';
import { ShipHeader } from './ship-header';
import { AREA, carried, labelContext, labelledFleet, PROJECT } from '../../../../lib/fixtures/labels.fixtures';
import { ShipLabelsEdit } from './ship-labels-edit';
import { ARGO_SHIP, AWAITING_SHIP, CREWED_SHIP, minutesAgo, NOW, PULL_WAY, RETIRED_SHIP, UNKNOWN_SHIP_ID, WATCHER_BUSY_WAY } from '../../../../lib/fixtures/ship-page.fixtures';
import { shipWayView } from '../../services/ship-way';
import { ShipWayLines } from '../molecules/ship-way-lines';
import { VIEWER_FLEET_ID } from '../../../../lib/fixtures/report.fixtures';

const meta = {
  title: 'Organisms/ShipHeader',
  component: ShipHeader,
  args: { ship: CREWED_SHIP, state: 'ready', now: NOW, viewerFleetId: VIEWER_FLEET_ID, actions: <Button size="sm">Release</Button> },
} satisfies Meta<typeof ShipHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Crewed: Story = {};
export const AwaitingCrew: Story = {
  args: {
    ship: AWAITING_SHIP,
    actions: (
      <Button variant="primary" size="sm" icon={<KeyRound aria-hidden />}>
        Get starting prompt
      </Button>
    ),
  },
};
/** reviewer-01 after argo pinged it: waiting, answered with pong, or acknowledged without pong. */
export const PingWaiting: Story = {
  args: { ship: { ...CREWED_SHIP, ping: { state: 'waiting', sentAt: minutesAgo(3), answeredAt: null } } },
};
export const PingAnswered: Story = {
  args: {
    ship: {
      ...CREWED_SHIP,
      ping: { state: 'answered', sentAt: minutesAgo(3), answeredAt: new Date(NOW.getTime() - 3 * 60_000 + 4_000).toISOString() },
    },
  },
};
export const PingReceived: Story = {
  args: { ship: { ...CREWED_SHIP, ping: { state: 'acknowledged', sentAt: minutesAgo(3), answeredAt: null } } },
};
/** A ship commissioned with fleet access: its fleet scopes beside its type. */
export const WithFleetScopes: Story = {
  args: { ship: { ...CREWED_SHIP, scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'] } },
};
/** A crew that reported it is blocked, with a note. */
export const Reported: Story = {
  args: { ship: { ...CREWED_SHIP, report: { state: 'blocked', note: 'waiting for review on PR 88', task: null, step: null, reportedAt: minutesAgo(3), reportChangedAt: minutesAgo(3), detailsVersion: 0, details: null, detailsBytes: null } } },
};
/** The monitoring design's Activity line under the report: what the trierarch last observed of the session. */
export const WithActivity: Story = {
  args: { ship: { ...CREWED_SHIP, activity: { at: minutesAgo(2), kind: 'tool', tool: 'Bash', reportedAt: minutesAgo(0.2), intervalSeconds: 30 } } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('ship-activity')).toHaveTextContent('Tool call 2 min ago');
  },
};
/** The trierarch stopped writing: activity unknown, with when it last reported, never stopped work. */
export const ActivityUnknown: Story = {
  args: { ship: { ...CREWED_SHIP, activity: { at: minutesAgo(30), kind: 'tool', tool: 'Bash', reportedAt: minutesAgo(25), intervalSeconds: 30 } } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('ship-activity')).toHaveTextContent('Activity unknown, trierarch last reported 25 min ago');
  },
};
export const ActivityUnknownPhone: Story = { ...ActivityUnknown, globals: { viewport: { value: 'mobile1' } } };
export const WithReportDetails: Story = {
  args: {
    ship: {
      ...CREWED_SHIP,
      report: { state: 'working', note: '4 of 6 running, 1 crashed', task: null, step: null, reportedAt: minutesAgo(1), reportChangedAt: minutesAgo(1), detailsVersion: 12, details: { running: 4, crashed: 1 }, detailsBytes: 25 },
    },
  },
};
export const Argo: Story = { args: { ship: ARGO_SHIP, actions: undefined } };
export const Retired: Story = { args: { ship: RETIRED_SHIP } };
export const Loading: Story = { args: { ship: undefined, state: 'loading' } };
export const NotFound: Story = { args: { ship: undefined, shipId: UNKNOWN_SHIP_ID, state: 'not-found' } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };

const LABEL_CHIPS = [
  { labelId: 'lbl_project', valueId: 'lbv_project_hemma', key: 'project', value: 'hemma', mark: 'none', ownerName: 'argo' },
  { labelId: 'lbl_area', valueId: 'lbv_area_backend', key: 'area', value: 'backend', mark: 'none', ownerName: 'argo' },
  { labelId: 'lbl_blueprint', valueId: 'lbv_blueprint_hemma-feature', key: 'blueprint', value: 'hemma-feature', mark: 'squadrons', ownerName: 'squadrons' },
] as const;

/** With labels (#102): at the foot of the meta strip, two shown, then "+1". */
export const WithLabels: Story = { args: { labels: <ShipLabels chips={LABEL_CHIPS} /> } };
/** A ship without labels says so. */
export const WithoutLabels: Story = { args: { labels: <ShipLabels chips={[]} /> } };
/** On phone, the labels row stacks under its title. */
export const WithLabelsPhone: Story = { args: { labels: <ShipLabels chips={LABEL_CHIPS} /> }, globals: { viewport: { value: 'mobile1' } } };

const ARGO_LABELS = { labels: [carried(PROJECT, 'hemma'), carried(AREA, 'frontend')] };
const LABEL_CONTEXT = labelContext(labelledFleet());

/** argo's own ship takes argo's labels as any ship does (decision 0031): yours to change or remove, and Add label. */
export const ArgoWithItsLabels: Story = {
  args: {
    ship: ARGO_SHIP,
    actions: undefined,
    labels: (
      <ShipLabelsEdit
        chips={chipsOf(ARGO_LABELS, LABEL_CONTEXT)}
        keys={assignKeysOf(ARGO_LABELS, LABEL_CONTEXT)}
        limit={labelLimitOf(ARGO_LABELS, SHIP_LABELS_MAX)}
        onAssign={fn()}
        onUnassign={fn()}
        onChange={fn()}
      />
    ),
  },
};

/** A plugin's own ship, squadrons' here: a plugin chip beside its type (#368), with the scopes the console commissions it with. */
export const PluginShip: Story = {
  args: {
    ship: { ...CREWED_SHIP, name: SQUADRONS_SHIP.name, type: SQUADRONS_SHIP.type, scopes: ['messages:send', 'messages:receive', ...SQUADRONS_SHIP.scopes] },
    isPluginShip: true,
  },
};

/** A plugin ship reports what it does (decision 0050): its report line and details show, as an agent ship's do. */
export const PluginShipReported: Story = {
  args: {
    ship: {
      ...CREWED_SHIP,
      kind: 'plugin',
      name: SQUADRONS_SHIP.name,
      type: SQUADRONS_SHIP.type,
      model: null,
      report: { state: 'working', note: 'Watching 2 squadrons', task: null, step: null, reportedAt: minutesAgo(1), reportChangedAt: minutesAgo(1), detailsVersion: 3, details: { squadrons: 2 }, detailsBytes: 15 },
    },
    isPluginShip: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('ship-report')).toHaveTextContent('Watching 2 squadrons');
    await expect(canvas.getByTestId('ship-report-details')).toBeInTheDocument();
  },
};

/** Its side of the way in the Delivery row (#756): the plugin watcher, busy, its oldest pending past 60 min. */
export const WithDelivery: Story = {
  args: { way: <ShipWayLines view={shipWayView(WATCHER_BUSY_WAY, { now: NOW })} onOpenMessage={fn()} /> },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('ship-delivery')).toHaveTextContent('Plugin watcher');
  },
};

/** A pull lease: no trierarch, no plugin. */
export const WithPullDelivery: Story = { args: { way: <ShipWayLines view={shipWayView(PULL_WAY, { now: NOW })} onOpenMessage={fn()} /> } };

export const WithDeliveryDark: Story = { ...WithDelivery, globals: { theme: 'dark' } };
export const WithDeliveryPhone: Story = { ...WithDelivery, globals: { viewport: { value: 'mobile1' } } };

/** What its crew says it is and offers (decision 0047). */
export const WithStatement: Story = {
  args: { ship: { ...CREWED_SHIP, statement: { by: 'crew', version: 1, summary: 'Reviews pull requests.', capabilities: [{ name: 'review_pr', title: 'Review a pull request' }] } } },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('ship-statement')).toHaveTextContent('Reviews pull requests.');
  },
};

const GATEWAY = { shipId: idSchema('ship').parse('shp_01jc9t5n2w8q4r7x3k6m1v4mzk'), name: 'gateway' };
const SUPPORT_DESK = { ...CREWED_SHIP, name: 'support-desk', type: 'person', kind: 'person' as const, harness: 'gateway', location: { kind: 'CLOUD' as const, description: null } };
const ACME_INTAKE = { ...CREWED_SHIP, name: 'acme-intake', type: 'mcp-client', kind: 'app' as const, commissionedByShipId: GATEWAY.shipId };

/** A sealed fleet, a ship the gateway crews: the mark names the gateway's ship (decision 0068, B19). */
export const ReadByGatewayCrew: Story = {
  args: { ship: SUPPORT_DESK, gatewayReader: { as: 'crew', gateway: GATEWAY } },
  play: async ({ canvasElement }) => {
    const mark = within(canvasElement).getByTestId('ship-gateway-mark');
    await expect(mark).toHaveTextContent('The gateway reads this ship’s payloads: gateway crews it.');
    await expect(within(mark).getByRole('link', { name: 'gateway' })).toHaveAttribute('href', `/ships/${GATEWAY.shipId}`);
  },
};
/** A sealed fleet, the gateway's proxy ship: the mark says so. */
export const ReadByGatewayProxyShip: Story = {
  args: { ship: ACME_INTAKE, gatewayReader: { as: 'proxyShip', gateway: GATEWAY } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('ship-gateway-mark')).toHaveTextContent('The gateway reads this ship’s payloads: it is gateway’s proxy ship for an outside party.');
  },
};
/** The gateway crews it and the console does not know its connection: named, not linked. */
export const ReadByGatewayUnlinked: Story = { args: { ship: SUPPORT_DESK, gatewayReader: { as: 'crew', gateway: { name: 'gateway' } } } };
/** A ship crewed elsewhere, or any ship in a fleet without sealing: no mark. */
export const NotReadByGateway: Story = {
  args: { ship: SUPPORT_DESK },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('ship-gateway-mark')).toBeNull();
  },
};
export const ReadByGatewayCrewPhone: Story = { args: { ship: SUPPORT_DESK, gatewayReader: { as: 'crew', gateway: GATEWAY } }, globals: { viewport: { value: 'mobile1' } } };
export const ReadByGatewayProxyShipPhone: Story = { args: { ship: ACME_INTAKE, gatewayReader: { as: 'proxyShip', gateway: GATEWAY } }, globals: { viewport: { value: 'mobile1' } } };

/** A crewed agent ship whose session stated no harness (aeolus-fleet#1408): Harness unknown, a fault, in the Location cell before its model. */
export const HarnessUnknown: Story = {
  args: { ship: { ...CREWED_SHIP, harness: null, model: { id: 'gpt-5.6-terra', statedAt: minutesAgo(1) } } },
  play: async ({ canvasElement }) => {
    const model = within(canvasElement).getByTestId('ship-model');
    await expect(within(model).getByTestId('harness-unknown')).toHaveTextContent('Harness unknown');
    await expect(model).toHaveTextContent('gpt-5.6-terra');
  },
};

/** argo's console lease states no harness, and that is no fault. */
export const ArgoNoHarnessFault: Story = {
  args: { ship: ARGO_SHIP, actions: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('harness-unknown')).toBeNull();
  },
};

/** The monitoring design's open alert above the meta strip, with activity unknown: what parted and for how long, the expectation, since when, the owner told. */
export const OpenAlert: Story = {
  args: {
    ship: {
      ...CREWED_SHIP,
      activity: { at: minutesAgo(30), kind: 'tool', tool: 'Bash', reportedAt: minutesAgo(25), intervalSeconds: 30 },
      openAlertCount: 1,
      openAlerts: [
        {
          id: 'alt_01m66p4k2v9qz8f7x3n5c1b0td',
          ship: { id: CREWED_SHIP.id, name: CREWED_SHIP.name },
          signal: 'report-unchanged',
          facts: { reportChangedAt: minutesAgo(190), state: 'working', minutes: 60, setBy: 'shp_01m66p4k2v9qz8f7x3n5c1r1x0' },
          occurrenceKey: CREWED_SHIP.id,
          ownerShipId: 'shp_01m66p4k2v9qz8f7x3n5c1r1x0',
          since: minutesAgo(190),
          raisedAt: minutesAgo(130),
          cleared: null,
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const alert = within(canvasElement).getByTestId('ship-open-alert');
    await expect(alert).toHaveTextContent('Report unchanged 3 h 10 min');
    await expect(alert).toHaveTextContent('Expected within 60 min');
    await expect(alert).toHaveTextContent('owner told · clears by itself');
  },
};
export const OpenAlertPhone: Story = { ...OpenAlert, globals: { viewport: { value: 'mobile1' } } };
export const OpenAlertDark: Story = { ...OpenAlert, globals: { theme: 'dark' } };
