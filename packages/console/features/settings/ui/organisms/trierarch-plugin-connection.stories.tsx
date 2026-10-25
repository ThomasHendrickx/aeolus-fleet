import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { TrierarchPluginConnection } from './trierarch-plugin-connection';

const SHIP_ID = 'shp_01m4ahmavehywpqm4hnbgzs03w';

const meta = {
  title: 'Organisms/TrierarchPluginConnection',
  component: TrierarchPluginConnection,
  args: { onRetry: () => undefined, onConnect: () => undefined, isConnecting: false, hasConnected: false },
} satisfies Meta<typeof TrierarchPluginConnection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Without the plugin, or with it off for this fleet: the browser sees the two alike (decision 0033). */
export const NotSetUp: Story = { args: { settings: { state: 'none' } } };
export const NotConnected: Story = { args: { settings: { state: 'not-connected', ship: null, lastShipId: null } } };
export const Connecting: Story = { args: { ...NotConnected.args, isConnecting: true } };
export const ConnectFailed: Story = {
  args: { ...NotConnected.args, connectError: 'A ship named trierarch-plugin of another type exists: rename or retire it, then connect again' },
};
export const Connected: Story = {
  args: { settings: { state: 'connected', ship: { shipId: SHIP_ID, name: 'trierarch-plugin' }, lastShipId: SHIP_ID, missingScopes: [] } },
};
/** Connected before the trierarch plugin listed scopes:declare (#1226): Settings names it and offers to grant it. */
export const ConnectedMissingScopes: Story = {
  args: { settings: { state: 'connected', ship: { shipId: SHIP_ID, name: 'trierarch-plugin' }, lastShipId: SHIP_ID, missingScopes: ['scopes:declare'] } },
};
export const GrantingMissingScopes: Story = { args: { ...ConnectedMissingScopes.args, isConnecting: true } };
export const GrantFailed: Story = { args: { ...ConnectedMissingScopes.args, connectError: 'This call needs the scopes:grant scope' } };
export const Granted: Story = { args: { ...Connected.args, hasConnected: true } };
export const Loading: Story = { args: { settings: undefined } };
export const LoadFailed: Story = { args: { settings: undefined, loadError: 'the trierarch plugin or the fleet did not answer: try again in a moment' } };
