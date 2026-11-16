import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { WatchPluginConnection } from './watch-plugin-connection';

const SHIP_ID = 'shp_01m4ahmavehywpqm4hnbgzs03w';

const meta = {
  title: 'Organisms/WatchPluginConnection',
  component: WatchPluginConnection,
  args: { onRetry: () => Promise.resolve(), onConnect: () => undefined, isConnecting: false, hasConnected: false },
} satisfies Meta<typeof WatchPluginConnection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Without the watch plugin, or with it off for this fleet: nothing shows (design watch-connection, Q1). */
export const Unavailable: Story = {
  args: { settings: { state: 'none' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('settings-watch-plugin')).toBeNull();
  },
};
export const Loading: Story = {
  args: { settings: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText('Loading the watch plugin')).toBeVisible();
  },
};
/** The watch plugin or the fleet did not answer the read: the section error says so, and Try again reads it again. */
export const ReadFailed: Story = {
  args: { settings: undefined, loadError: 'the watch plugin or the fleet did not answer: try again in a moment', onRetry: fn(() => Promise.resolve()) },
  play: async ({ canvasElement, args }) => {
    // Given the read of the watch plugin failed
    const error = within(canvasElement).getByRole('alert');
    await expect(error).toHaveTextContent('Couldn’t read the watch plugin');
    await expect(error).toHaveTextContent('the watch plugin or the fleet did not answer: try again in a moment');

    // When the operator presses Try again
    await userEvent.click(within(error).getByRole('button', { name: 'Try again' }));

    // Then the section is read again
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};
/** Not connected: Connect watch plugin commissions watch-plugin with fleet:read and fleet:alert, or gives it a new starting prompt. */
export const NotConnected: Story = {
  args: { settings: { state: 'not-connected', ship: null, lastShipId: null }, onConnect: fn() },
  play: async ({ canvasElement, args }) => {
    // Given the watch plugin on for the fleet and not connected
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Watch plugin' })).toBeVisible();
    await expect(canvas.getByTestId('settings-watch-plugin-state')).toHaveTextContent(
      'Not connected. Connecting commissions the ship watch-plugin, with fleet read and alert, or gives it a new starting prompt, and hands its secret to the watch plugin. No one sees the secret.',
    );

    // When the operator presses Connect watch plugin
    await userEvent.click(canvas.getByTestId('settings-watch-plugin-connect'));

    // Then the console connects it
    await expect(args.onConnect).toHaveBeenCalledOnce();
  },
};
/** Connecting: the button shows it is working and cannot be pressed twice. */
export const Connecting: Story = {
  args: { ...NotConnected.args, isConnecting: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('settings-watch-plugin-connect')).toBeDisabled();
  },
};
/** Connecting failed: the reason shows, as the plugin or the fleet says it, so the operator knows what to do. */
export const ConnectFailed: Story = {
  args: { ...NotConnected.args, connectError: 'A ship named watch-plugin of another type exists: rename or retire it, then connect again' },
  play: async ({ canvasElement }) => {
    const error = within(canvasElement).getByRole('alert');
    await expect(error).toHaveTextContent('Couldn’t connect the watch plugin');
    await expect(error).toHaveTextContent('A ship named watch-plugin of another type exists: rename or retire it, then connect again');
  },
};
export const Connected: Story = {
  args: { settings: { state: 'connected', ship: { shipId: SHIP_ID, name: 'watch-plugin' }, lastShipId: SHIP_ID, scopes: { kind: 'read', missingScopes: [] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('settings-watch-plugin-state')).toHaveTextContent(`Connected as watch-plugin (${SHIP_ID})`);
    await expect(canvas.queryByTestId('settings-watch-plugin-connect')).toBeNull();
  },
};
/** Connected as a ship that lacks fleet:alert: the console names it and offers to grant it, through the same connect. */
export const MissingScopes: Story = {
  args: { settings: { state: 'connected', ship: { shipId: SHIP_ID, name: 'watch-plugin' }, lastShipId: SHIP_ID, scopes: { kind: 'read', missingScopes: ['fleet:alert'] } }, onConnect: fn() },
  play: async ({ canvasElement, args }) => {
    // Given the watch plugin connected as watch-plugin, which lacks fleet:alert
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('settings-watch-plugin-missing-scopes')).toHaveTextContent('fleet:alert');

    // When the operator presses Grant missing scopes
    await userEvent.click(canvas.getByTestId('settings-watch-plugin-grant-scopes'));

    // Then the console connects it again, which grants them
    await expect(args.onConnect).toHaveBeenCalledOnce();
  },
};
export const Granting: Story = {
  args: { ...MissingScopes.args, isConnecting: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('settings-watch-plugin-grant-scopes')).toBeDisabled();
  },
};
export const GrantFailed: Story = {
  args: { ...MissingScopes.args, connectError: 'The fleet did not answer' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('The fleet did not answer');
  },
};
export const Granted: Story = {
  args: { ...Connected.args, hasConnected: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('settings-watch-plugin-scopes-granted')).toBeVisible();
  },
};
/** The fleet did not answer the read of watch-plugin's scopes (#1259): the connection stays shown, and under it the section error says the scopes are unknown, with Try again. */
export const ScopesReadFailed: Story = {
  args: { settings: { state: 'connected', ship: { shipId: SHIP_ID, name: 'watch-plugin' }, lastShipId: SHIP_ID, scopes: { kind: 'failed', reason: 'The fleet did not answer' } }, onRetry: fn(() => Promise.resolve()) },
  play: async ({ canvasElement, args }) => {
    // Given the watch plugin connected as watch-plugin, whose scopes the fleet did not answer for
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('settings-watch-plugin-state')).toHaveTextContent('Connected as watch-plugin');
    const error = canvas.getByRole('alert');
    await expect(error).toHaveTextContent('Couldn’t read the scopes of watch-plugin');
    await expect(canvas.queryByTestId('settings-watch-plugin-grant-scopes')).toBeNull();

    // When the operator presses Try again
    await userEvent.click(within(error).getByRole('button', { name: 'Try again' }));

    // Then the section is read again
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};
