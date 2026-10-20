import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { GatewayConnection } from './gateway-connection';

const SHIP_ID = 'shp_01m4jtkdcqe51e0v00c76eec2e';

const meta = {
  title: 'Organisms/GatewayConnection',
  component: GatewayConnection,
  args: { onRetry: () => undefined, onConnect: () => undefined, isConnecting: false },
} satisfies Meta<typeof GatewayConnection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Without the gateway, or with it off for this fleet: nothing shows (decision 0033). */
export const NotSetUp: Story = { args: { settings: { state: 'none' } } };
export const NotConnected: Story = { args: { settings: { state: 'not-connected', ship: null, lastShipId: null } } };
export const Connecting: Story = { args: { ...NotConnected.args, isConnecting: true } };
/** The gateway refuses to connect, and says why. */
export const ConnectFailed: Story = {
  args: { ...NotConnected.args, connectError: 'The ship needs fleet:read, fleet:commission, fleet:on-behalf, scopes:declare, fleet:verify' },
};
export const Connected: Story = {
  args: { settings: { state: 'connected', ship: { shipId: SHIP_ID, name: 'gateway' }, lastShipId: SHIP_ID } },
};
export const Loading: Story = { args: { settings: undefined } };
export const LoadFailed: Story = { args: { settings: undefined, loadError: 'the gateway or the fleet did not answer: try again in a moment' } };
