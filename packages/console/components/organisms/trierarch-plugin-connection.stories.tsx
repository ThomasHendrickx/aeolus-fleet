import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { TrierarchPluginConnection } from './trierarch-plugin-connection';

const SHIP_ID = 'shp_01m4ahmavehywpqm4hnbgzs03w';

const meta = {
  title: 'Organisms/TrierarchPluginConnection',
  component: TrierarchPluginConnection,
  args: { onRetry: () => undefined, onConnect: () => undefined, isConnecting: false },
} satisfies Meta<typeof TrierarchPluginConnection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotSetUp: Story = { args: { settings: { configured: false } } };
export const OffForThisFleet: Story = { args: { settings: { configured: true, connection: { isEnabled: false, state: 'not-connected', ship: null, lastShipId: null } } } };
export const NotConnected: Story = { args: { settings: { configured: true, connection: { isEnabled: true, state: 'not-connected', ship: null, lastShipId: null } } } };
export const Connecting: Story = { args: { ...NotConnected.args, isConnecting: true } };
export const ConnectFailed: Story = {
  args: { ...NotConnected.args, connectError: 'A ship named trierarch-plugin of another type exists: rename or retire it, then connect again' },
};
export const Connected: Story = {
  args: { settings: { configured: true, connection: { isEnabled: true, state: 'connected', ship: { shipId: SHIP_ID, name: 'trierarch-plugin' }, lastShipId: SHIP_ID } } },
};
export const Loading: Story = { args: { settings: undefined } };
export const LoadFailed: Story = { args: { settings: undefined, loadError: 'the trierarch plugin or the fleet did not answer: try again in a moment' } };
