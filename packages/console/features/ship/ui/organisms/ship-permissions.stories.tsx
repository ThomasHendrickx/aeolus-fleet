import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
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
    await expect(screen.getByRole('checkbox', { name: /Read leads/ })).toBeDisabled();
    await expect(screen.getByRole('checkbox', { name: /Send messages/ })).toBeDisabled();
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
    await waitFor(async () => { await expect(screen.getByTestId('ship-permissions-save')).toBeDisabled(); });
    await expect(screen.getByTestId('ship-permissions-save')).toHaveTextContent('Saving permissions');
  },
};
