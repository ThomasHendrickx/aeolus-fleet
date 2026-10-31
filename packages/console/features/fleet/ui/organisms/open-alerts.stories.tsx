import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { OpenAlerts } from './open-alerts';

const NOW = new Date(2026, 9, 31, 14, 53);

const meta = {
  title: 'Fleet/Organisms/OpenAlerts',
  component: OpenAlerts,
  args: {
    now: NOW,
    hasMore: false,
    alerts: [
      {
        id: 'alt_01m66p4k2v9qz8f7x3n5c1b0td',
        ship: { id: 'shp_01m66p4k2v9qz8f7x3n5c1dbt0', name: 'deploy-bot' },
        signal: 'delivery-unacknowledged',
        facts: { deliveryId: 'dlv_01m66p4k2v9qz8f7x3n5c1d1v1', messageId: 'msg_01m66p4k2v9qz8f7x3n5c1msg1', state: 'pending', awaitingCrew: true, minutes: 15 },
        occurrenceKey: 'dlv_01m66p4k2v9qz8f7x3n5c1d1v1',
        ownerShipId: 'shp_01m66p4k2v9qz8f7x3n5c1r1x0',
        since: new Date(2026, 9, 31, 14, 31).toISOString(),
        raisedAt: new Date(2026, 9, 31, 14, 46).toISOString(),
        cleared: null,
      },
      {
        id: 'alt_01m66p4k2v9qz8f7x3n5c1b0te',
        ship: { id: 'shp_01m66p4k2v9qz8f7x3n5c14ftc', name: 'merger-1' },
        signal: 'report-unchanged',
        facts: { reportChangedAt: new Date(2026, 9, 31, 12, 5).toISOString(), state: 'working', minutes: 60, setBy: 'shp_01m66p4k2v9qz8f7x3n5c1r1x0' },
        occurrenceKey: 'merger-1',
        ownerShipId: 'shp_01m66p4k2v9qz8f7x3n5c1r1x0',
        since: new Date(2026, 9, 31, 11, 53).toISOString(),
        raisedAt: new Date(2026, 9, 31, 13, 5).toISOString(),
        cleared: null,
      },
    ],
  },
} satisfies Meta<typeof OpenAlerts>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two open alerts, newest first, each with its ship and since when, clearing by themselves. */
export const TwoOpen: Story = {
  play: async ({ canvasElement }) => {
    const panel = within(canvasElement).getByTestId('fleet-open-alerts');
    await expect(panel).toHaveTextContent('Open alerts · 2');
    await expect(panel).toHaveTextContent('deploy-bot');
    await expect(panel).toHaveTextContent('Delivery unacknowledged 22 min, awaiting crew');
    await expect(panel).toHaveTextContent('since 14:31 · clears by itself');
  },
};

/** More open than the page holds. */
export const MoreThanAPage: Story = { args: { hasMore: true } };

/** None open: nothing shows. */
export const NoneOpen: Story = {
  args: { alerts: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('fleet-open-alerts')).toBeNull();
  },
};
