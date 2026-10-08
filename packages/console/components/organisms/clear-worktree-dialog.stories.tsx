import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { ClearWorktreeDialog } from './clear-worktree-dialog';

const meta = {
  title: 'Organisms/ClearWorktreeDialog',
  component: ClearWorktreeDialog,
  args: { worktree: { repository: 'aeolus-fleet', shipName: 'planner-1', machineName: 'trierarch-mac' }, onOpenChange: fn(), isPending: false, onClear: fn() },
} satisfies Meta<typeof ClearWorktreeDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Delete a kept worktree: its changes are lost, and the trierarch removes it on its next pass. */
export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body);
    await expect(dialog.getByText(/removes it on its next pass/)).toBeVisible();
    await userEvent.click(dialog.getByTestId('clear-worktree-confirm'));
    await expect(args.onClear).toHaveBeenCalledOnce();
  },
};
export const Deleting: Story = { args: { isPending: true } };
/** The trierarch was retired meanwhile: the server refuses. */
export const Refused: Story = { args: { error: 'trierarch-mac is retired: a retired trierarch clears nothing' } };
