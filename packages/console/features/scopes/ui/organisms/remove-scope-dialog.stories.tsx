import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';

import { RemoveScopeDialog } from './remove-scope-dialog';

const meta = {
  title: 'Organisms/RemoveScopeDialog',
  component: RemoveScopeDialog,
  args: { scope: 'crm:admin', onOpenChange: fn(), isPending: false, onRemove: fn() },
} satisfies Meta<typeof RemoveScopeDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Asks first. */
export const Confirm: Story = {};
/** Remove scope removes that scope once confirmed. */
export const Removes: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByTestId('remove-scope-confirm'));
    await expect(args.onRemove).toHaveBeenCalledWith('crm:admin');
  },
};
export const Removing: Story = { args: { isPending: true } };
/** Refused while ships hold it, naming how many. */
export const Held: Story = { args: { error: '2 ships hold crm:admin: revoke it from them first' } };
