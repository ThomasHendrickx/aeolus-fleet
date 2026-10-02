import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { KeyRound } from 'lucide-react';

import { Button } from '../atoms/button';
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
export const Argo: Story = { args: { ship: ARGO_SHIP, actions: undefined } };
export const Retired: Story = { args: { ship: RETIRED_SHIP } };
export const Loading: Story = { args: { ship: undefined, state: 'loading' } };
export const NotFound: Story = { args: { ship: undefined, shipId: UNKNOWN_SHIP_ID, state: 'not-found' } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
