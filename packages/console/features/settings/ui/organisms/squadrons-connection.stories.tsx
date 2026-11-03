import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { SquadronsConnection } from './squadrons-connection';

const SHIP_ID = 'shp_01m3tbfspe96yf1rnr4ank9h1a';

const meta = {
  title: 'Organisms/SquadronsConnection',
  component: SquadronsConnection,
  args: { onRetry: () => undefined, onConnect: () => undefined, isConnecting: false, hasConnected: false, isRetrying: false },
} satisfies Meta<typeof SquadronsConnection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotConnected: Story = { args: { settings: { state: 'not-connected', ship: null, lastShipId: null } } };
export const Connecting: Story = { args: { ...NotConnected.args, isConnecting: true } };
/** Connecting failed: the reason shows, as the plugin or the fleet says it, so the operator knows what to do. */
export const ConnectFailed: Story = {
  args: { ...NotConnected.args, connectError: 'A ship named squadrons of another type exists: rename or retire it, then connect again' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('A ship named squadrons of another type exists: rename or retire it, then connect again');
  },
};
export const Connected: Story = {
  args: { settings: { state: 'connected', ship: { shipId: SHIP_ID, name: 'squadrons' }, lastShipId: SHIP_ID, scopes: { kind: 'read', missingScopes: [] } } },
};
export const Loading: Story = { args: { settings: undefined } };
export const LoadFailed: Story = { args: { settings: undefined, loadError: 'squadrons or the fleet did not answer: try again in a moment' } };

/** The fleet did not answer the read of squadrons's scopes (#1259): the connection stays shown, and under it the section error says the scopes are unknown, with Try again. */
export const ScopesReadFailed: Story = {
  args: { settings: { state: 'connected', ship: { shipId: SHIP_ID, name: 'squadrons' }, lastShipId: SHIP_ID, scopes: { kind: 'failed', reason: 'The fleet did not answer' } }, onRetry: fn() },
  play: async ({ canvasElement, args }) => {
    // Given squadrons connected as squadrons, whose scopes the fleet did not answer for
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('settings-squadrons-state')).toHaveTextContent('Connected as squadrons');
    const error = canvas.getByRole('alert');
    await expect(error).toHaveTextContent('Couldn’t read the scopes of squadrons');
    await expect(error).toHaveTextContent('The fleet did not answer. Nothing changed. Whether squadrons lacks a scope squadrons lists shows once the read succeeds.');
    await expect(canvas.queryByTestId('settings-squadrons-grant-scopes')).toBeNull();

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
