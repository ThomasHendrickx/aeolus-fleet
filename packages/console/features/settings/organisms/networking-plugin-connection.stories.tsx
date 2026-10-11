import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { NetworkingPluginConnection } from './networking-plugin-connection';

const SHIP_ID = 'shp_01m4jtkdcqe51e0v00c76eec2d';

const meta = {
  title: 'Organisms/NetworkingPluginConnection',
  component: NetworkingPluginConnection,
  args: { onRetry: () => undefined, onConnect: () => undefined, isConnecting: false },
} satisfies Meta<typeof NetworkingPluginConnection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Without the plugin, or with it off for this fleet: nothing shows (decision 0033). */
export const NotSetUp: Story = { args: { settings: { state: 'none' } } };
export const NotConnected: Story = { args: { settings: { state: 'not-connected', ship: null, lastShipId: null } } };
export const Connecting: Story = { args: { ...NotConnected.args, isConnecting: true } };
export const ConnectFailed: Story = {
  args: { ...NotConnected.args, connectError: 'A ship named networking-plugin of another type exists: rename or retire it, then connect again' },
};
export const Connected: Story = {
  args: { settings: { state: 'connected', ship: { shipId: SHIP_ID, name: 'networking-plugin' }, lastShipId: SHIP_ID } },
};
export const Loading: Story = { args: { settings: undefined } };
export const LoadFailed: Story = { args: { settings: undefined, loadError: 'the networking plugin or the fleet did not answer: try again in a moment' } };
