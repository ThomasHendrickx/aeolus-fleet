import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useEffect, useState } from 'react';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import { ShipPermissions } from './ship-permissions';

const meta = {
  title: 'Organisms/ShipPermissions',
  component: ShipPermissions,
  args: {
    shipName: 'reviewer-03', scopes: ['messages:send', 'messages:receive', 'fleet:read', 'crm:read-leads'],
    choices: [
      { scope: 'messages:send', description: 'Send messages', isLocked: true },
      { scope: 'messages:receive', description: 'Receive messages', isLocked: true },
      { scope: 'fleet:read', description: 'Read ships, timelines and messages.' },
      { scope: 'meetings:open', description: 'Invite ships to a meeting.' },
      { scope: 'crm:read-leads', description: 'Read leads', isLocked: true },
    ],
    canChange: true, isPending: false, onSave: fn(),
  },
} satisfies Meta<typeof ShipPermissions>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};
export const Editing: Story = {
  play: async () => {
    // Given a live ship with a permission the actor cannot change.
    await userEvent.click(screen.getByTestId('ship-permissions-change'));
    // When the actor removes one permission and adds another.
    await userEvent.click(screen.getByRole('checkbox', { name: /Read the fleet/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Open a meeting/ }));
    // Then the changes and the locked permission are explicit.
    await expect(screen.getByText('1 permission added · 1 removed')).toBeVisible();
    await expect(screen.getByRole('checkbox', { name: /Read leads/ })).toHaveAttribute('data-disabled');
    await expect(screen.getByRole('checkbox', { name: /Send messages/ })).toHaveAttribute('data-disabled');
  },
};
export const Save: Story = {
  play: async ({ args }) => {
    // Given an editable ship.
    await userEvent.click(screen.getByTestId('ship-permissions-change'));
    // When a permission is added and saved.
    await userEvent.click(screen.getByRole('checkbox', { name: /Open a meeting/ }));
    await userEvent.click(screen.getByTestId('ship-permissions-save'));
    // Then only the difference is submitted.
    await expect(args.onSave).toHaveBeenCalledWith({ grant: ['meetings:open'], revoke: [] });
  },
};
export const Cancel: Story = {
  play: async () => {
    await userEvent.click(screen.getByTestId('ship-permissions-change'));
    await userEvent.click(screen.getByRole('checkbox', { name: /Read the fleet/ }));
    await userEvent.click(screen.getByTestId('ship-permissions-cancel'));
    await userEvent.click(screen.getByTestId('ship-permissions-change'));
    await expect(screen.getByRole('checkbox', { name: /Read the fleet/ })).toBeChecked();
  },
};
export const ReadOnly: Story = { args: { canChange: false } };
export const Reading: Story = { args: { choices: undefined }, play: async () => { await userEvent.click(screen.getByTestId('ship-permissions-change')); } };
export const Failed: Story = { args: { error: 'Permission change refused. Nothing changed. Try again.' }, play: Editing.play };
export const Pending: Story = { args: { isPending: true }, play: async () => { await expect(screen.getByTestId('ship-permissions-save')).toHaveTextContent('Saving permissions'); } };

function DelayedSave(args: React.ComponentProps<typeof ShipPermissions>) {
  const [isPending, setIsPending] = useState(false);
  return <ShipPermissions {...args} isPending={isPending} onSave={() => { setIsPending(true); }} />;
}
export const PressShowsPending: Story = {
  render: (args) => <DelayedSave {...args} />,
  play: async () => {
    await userEvent.click(screen.getByTestId('ship-permissions-change'));
    await userEvent.click(screen.getByRole('checkbox', { name: /Open a meeting/ }));
    await userEvent.click(screen.getByTestId('ship-permissions-save'));
    await waitFor(async () => { await expect(screen.getByTestId('ship-permissions-save')).toHaveAttribute('data-disabled'); });
    await expect(screen.getByTestId('ship-permissions-save')).toHaveTextContent('Saving permissions');
  },
};

/** All five rows in the approved editor fit without concealing the locked permission. */
export const HeldPermissionVisible: Story = {
  play: async () => {
    await userEvent.click(screen.getByTestId('ship-permissions-change'));
    const locked = screen.getByRole('checkbox', { name: /Read leads/ });
    const list = screen.getByTestId('permissions-choices');
    await expect(locked.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom).toBe(true);
  },
};

function LivePermissions(args: React.ComponentProps<typeof ShipPermissions>) {
  const [scopes, setScopes] = useState(args.scopes);
  useEffect(() => {
    const grant = () => { setScopes([...args.scopes, 'fleet:manage']); };
    window.addEventListener('permissions-granted', grant);
    return () => { window.removeEventListener('permissions-granted', grant); };
  }, [args.scopes]);
  return <ShipPermissions {...args} scopes={scopes} choices={[...(args.choices ?? []), { scope: 'fleet:manage', description: 'Manage ships' }]} />;
}
export const LivePermissionsKeepUntouchedScopes: Story = {
  render: (args) => <LivePermissions {...args} />,
  play: async ({ args }) => {
    // Given one permission being added in the editor.
    await userEvent.click(screen.getByTestId('ship-permissions-change'));
    await userEvent.click(screen.getByRole('checkbox', { name: /Open a meeting/ }));
    // When the fleet grants another permission while the editor stays open.
    window.dispatchEvent(new Event('permissions-granted'));
    // Then the untouched permission stays held and only the intended change is saved.
    await waitFor(async () => { await expect(screen.getByRole('checkbox', { name: /Manage ships/ })).toBeChecked(); });
    await userEvent.click(screen.getByTestId('ship-permissions-save'));
    await expect(args.onSave).toHaveBeenCalledWith({ grant: ['meetings:open'], revoke: [] });
  },
};
