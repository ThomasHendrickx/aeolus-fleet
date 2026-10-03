import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { SquadronsConnection } from './squadrons-connection';

const meta = {
  title: 'Organisms/SquadronsConnection',
  component: SquadronsConnection,
  args: { onRetry: () => undefined, onConnect: () => undefined, isConnecting: false },
} satisfies Meta<typeof SquadronsConnection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotConnected: Story = { args: { settings: { configured: true, connection: { state: 'not-connected', ship: null, lastShipId: null } } } };
export const Connecting: Story = { args: { ...NotConnected.args, isConnecting: true } };
export const ConnectFailed: Story = {
  args: { ...NotConnected.args, connectError: 'A ship named squadrons of another type exists: rename or retire it, then connect again' },
};
export const Connected: Story = {
  args: { settings: { configured: true, connection: { state: 'connected', ship: { shipId: 'shp_01m3tbfspe96yf1rnr4ank9h1a', name: 'squadrons' }, lastShipId: 'shp_01m3tbfspe96yf1rnr4ank9h1a' } } },
};
export const NotConfigured: Story = { args: { settings: { configured: false } } };
export const Loading: Story = { args: { settings: undefined } };
export const LoadFailed: Story = { args: { settings: undefined, loadError: 'squadrons or the fleet did not answer: try again in a moment' } };
