import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { TrierarchPluginConnection } from './trierarch-plugin-connection';

const SHIP_ID = 'shp_01m4ahmavehywpqm4hnbgzs03w';

const meta = {
  title: 'Organisms/TrierarchPluginConnection',
  component: TrierarchPluginConnection,
  args: { onRetry: () => undefined, onConnect: () => undefined, isConnecting: false, hasConnected: false, isRetrying: false },
} satisfies Meta<typeof TrierarchPluginConnection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Without the plugin, or with it off for this fleet: the browser sees the two alike (decision 0033). */
export const NotSetUp: Story = { args: { settings: { state: 'none' } } };
export const NotConnected: Story = { args: { settings: { state: 'not-connected', ship: null, lastShipId: null } } };
export const Connecting: Story = { args: { ...NotConnected.args, isConnecting: true } };
/** Connecting failed: the reason shows, as the plugin or the fleet says it, so the operator knows what to do. */
export const ConnectFailed: Story = {
  args: { ...NotConnected.args, connectError: 'A ship named trierarch-plugin of another type exists: rename or retire it, then connect again' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('A ship named trierarch-plugin of another type exists: rename or retire it, then connect again');
  },
};
export const Connected: Story = {
  args: { settings: { state: 'connected', ship: { shipId: SHIP_ID, name: 'trierarch-plugin' }, lastShipId: SHIP_ID, scopes: { kind: 'read', missingScopes: [] } } },
};
/** Connected before the trierarch plugin listed scopes:declare (#1226): Settings names it and offers to grant it. */
export const ConnectedMissingScopes: Story = {
  args: { settings: { state: 'connected', ship: { shipId: SHIP_ID, name: 'trierarch-plugin' }, lastShipId: SHIP_ID, scopes: { kind: 'read', missingScopes: ['scopes:declare'] } } },
};
export const GrantingMissingScopes: Story = { args: { ...ConnectedMissingScopes.args, isConnecting: true } };
export const GrantFailed: Story = { args: { ...ConnectedMissingScopes.args, connectError: 'This call needs the scopes:grant scope' } };
export const Granted: Story = { args: { ...Connected.args, hasConnected: true } };
export const Loading: Story = { args: { settings: undefined } };
export const LoadFailed: Story = { args: { settings: undefined, loadError: 'the trierarch plugin or the fleet did not answer: try again in a moment' } };

/** The fleet did not answer the read of trierarch-plugin's scopes (#1259): the connection stays shown, and under it the section error says the scopes are unknown, with Try again. */
export const ScopesReadFailed: Story = {
  args: { settings: { state: 'connected', ship: { shipId: SHIP_ID, name: 'trierarch-plugin' }, lastShipId: SHIP_ID, scopes: { kind: 'failed', reason: 'The fleet did not answer' } }, onRetry: fn() },
  play: async ({ canvasElement, args }) => {
    // Given the trierarch plugin connected as trierarch-plugin, whose scopes the fleet did not answer for
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('settings-trierarchs-state')).toHaveTextContent('Connected as trierarch-plugin');
    const error = canvas.getByRole('alert');
    await expect(error).toHaveTextContent('Couldn’t read the scopes of trierarch-plugin');
    await expect(error).toHaveTextContent('The fleet did not answer. Nothing changed. Whether trierarch-plugin lacks a scope the trierarch plugin lists shows once the read succeeds.');
    await expect(canvas.queryByTestId('settings-trierarchs-grant-scopes')).toBeNull();

    // When the operator presses Try again
    await userEvent.click(within(error).getByRole('button', { name: 'Try again' }));

    // Then the section is read again
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};
/** Try again pressed: the button shows it is working until the read answers. */
export const RetryingScopesRead: Story = {
  args: { ...ScopesReadFailed.args, isRetrying: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Trying again…' })).toHaveAttribute('aria-busy', 'true');
  },
};
