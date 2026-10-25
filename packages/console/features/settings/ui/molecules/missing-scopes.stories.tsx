import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { MissingScopes } from './missing-scopes';

const meta = {
  title: 'Molecules/MissingScopes',
  component: MissingScopes,
  args: {
    plugin: 'the trierarch plugin',
    shipName: 'trierarch-plugin',
    missingScopes: ['scopes:declare'],
    isGranting: false,
    hasGranted: false,
    onGrant: fn(),
    testId: 'settings-trierarchs',
  },
} satisfies Meta<typeof MissingScopes>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A ship connected before its plugin listed scopes:declare (#1226): Settings names it, and Grant missing scopes grants it. */
export const Missing: Story = {
  play: async ({ args, canvasElement }) => {
    const notice = within(canvasElement).getByTestId('settings-trierarchs-missing-scopes');
    await expect(notice).toHaveTextContent('trierarch-plugin lacks a scope the trierarch plugin lists: scopes:declare.');
    await userEvent.click(within(notice).getByRole('button', { name: 'Grant missing scopes' }));
    await expect(args.onGrant).toHaveBeenCalledOnce();
  },
};

export const SeveralMissing: Story = {
  args: { missingScopes: ['scopes:declare', 'labels:assign'] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('settings-trierarchs-missing-scopes')).toHaveTextContent('lacks scopes the trierarch plugin lists: scopes:declare, labels:assign.');
  },
};

/** Granting while the server works: the button says so, with a spinner, and takes no second press. */
export const Granting: Story = {
  args: { isGranting: true },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Granting missing scopes…' });
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button, { pointerEventsCheck: 0 });
    await expect(args.onGrant).not.toHaveBeenCalled();
  },
};

/** The grant failed: the scopes stay named, the fleet's reason shows, and the button tries again. */
export const GrantFailed: Story = {
  args: { grantError: 'This call needs the scopes:grant scope' },
  play: async ({ args, canvasElement }) => {
    const notice = within(canvasElement).getByTestId('settings-trierarchs-missing-scopes');
    await expect(within(notice).getByRole('alert')).toHaveTextContent('Couldn’t grant the missing scopesThis call needs the scopes:grant scope. Nothing changed: try again.');
    await userEvent.click(within(notice).getByRole('button', { name: 'Grant missing scopes' }));
    await expect(args.onGrant).toHaveBeenCalledOnce();
  },
};

/** The grant succeeded: nothing is missing, and it says the ship holds every scope. */
export const Granted: Story = {
  args: { missingScopes: [], hasGranted: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('trierarch-plugin holds every scope the trierarch plugin lists.');
  },
};

/** Nothing missing and nothing granted: it shows nothing. */
export const NothingMissing: Story = {
  args: { missingScopes: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('settings-trierarchs-missing-scopes')).toBeNull();
  },
};
