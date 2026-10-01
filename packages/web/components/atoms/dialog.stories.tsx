import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CircleAlert } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog';
import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Input } from './input';
import { Label } from './label';

const meta = {
  title: 'Atoms/Dialog',
  component: Dialog,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="min-h-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function ReleaseConfirm({ isBusy = false, hasError = false }: { isBusy?: boolean; hasError?: boolean }) {
  return (
    <AlertDialog defaultOpen>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Release reviewer-01?</AlertDialogTitle>
          <AlertDialogDescription>The session on hetzner-1 loses this ship now.</AlertDialogDescription>
        </AlertDialogHeader>
        {hasError ? (
          <div
            role="alert"
            className="flex gap-2.5 rounded-lg border border-tone-attention-border bg-tone-attention-bg px-3.5 py-3 text-meta text-tone-attention-fg"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
            <span>Couldn’t release the ship. The server did not answer. Nothing changed; try again.</span>
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button disabled={isBusy} />}>Cancel</AlertDialogClose>
          <Button variant="primary" isLoading={isBusy}>
            {isBusy ? 'Releasing' : 'Release ship'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export const Confirm: Story = { render: () => <ReleaseConfirm /> };
export const ConfirmBusy: Story = { render: () => <ReleaseConfirm isBusy /> };
export const ConfirmError: Story = { render: () => <ReleaseConfirm hasError /> };

export const Form: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Rename reviewer-01</DialogTitle>
          <DialogDescription>
            Agents that address it by its old name stop reaching it. History and ids stay.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-name">New name</Label>
          <Input id="new-name" isMono defaultValue="reviewer-01" />
        </div>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button variant="primary">Rename ship</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};
