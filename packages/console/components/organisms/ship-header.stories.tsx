import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { KeyRound } from 'lucide-react';

import { Button } from '../atoms/button';
import { ShipLabels } from '../molecules/ship-labels';
import { ShipHeader } from './ship-header';
import { ARGO_SHIP, AWAITING_SHIP, CREWED_SHIP, minutesAgo, NOW, RETIRED_SHIP, UNKNOWN_SHIP_ID } from './ship-page.fixtures';

const meta = {
  title: 'Organisms/ShipHeader',
  component: ShipHeader,
  args: { ship: CREWED_SHIP, state: 'ready', now: NOW, actions: <Button size="sm">Release</Button> },
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
  args: { ship: { ...CREWED_SHIP, ping: { state: 'received', sentAt: minutesAgo(3), answeredAt: null } } },
};
/** A ship commissioned with fleet access: its fleet scopes beside its type. */
export const WithFleetScopes: Story = {
  args: { ship: { ...CREWED_SHIP, scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'] } },
};
/** A crew that reported it is blocked, with a note. */
export const Reported: Story = {
  args: { ship: { ...CREWED_SHIP, report: { state: 'blocked', note: 'waiting for review on PR 88', reportedAt: minutesAgo(3), detailsVersion: 0, details: null } } },
};
export const WithReportDetails: Story = {
  args: {
    ship: {
      ...CREWED_SHIP,
      report: { state: 'working', note: '4 of 6 running, 1 crashed', reportedAt: minutesAgo(1), detailsVersion: 12, details: { running: 4, crashed: 1 } },
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

/** A plugin's own ship, squadrons' here: a plugin chip beside its type (#368). */
export const PluginShip: Story = {
  args: { ship: { ...CREWED_SHIP, name: 'squadrons', type: 'squadrons', scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'] }, isPluginShip: true },
};
