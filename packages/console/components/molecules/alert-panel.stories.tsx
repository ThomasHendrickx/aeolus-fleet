import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { AlertPanel } from './alert-panel';

const meta = {
  title: 'Molecules/AlertPanel',
  component: AlertPanel,
  args: {
    heading: 'Open alerts · 2',
    lines: [
      { key: 'a', ship: 'deploy-bot', text: 'Delivery unacknowledged 22 min, awaiting crew', caption: 'since 14:31 · clears by itself' },
      { key: 'b', ship: 'merger-1', text: 'Report unchanged 3 h, expected within 60 min', caption: 'since 12:05 · clears by itself' },
    ],
  },
} satisfies Meta<typeof AlertPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The overview's Open alerts: one line per alert, each naming its ship. */
export const FleetOpenAlerts: Story = {};

/** The ship page's open alert: what parted as the heading, then the expectation and since when. */
export const ShipOpenAlert: Story = {
  args: { heading: 'Report unchanged 3 h 10 min', lines: [{ key: 'a', text: 'Expected within 60 min', caption: 'since 12:05 · owner told · clears by itself' }] },
};

/** A signal with nothing more to say: the caption alone. */
export const WithoutDetail: Story = {
  args: { heading: 'Ping unanswered 14 min', lines: [{ key: 'a', text: '', caption: 'since 15:01 · owner told · clears by itself' }] },
};
