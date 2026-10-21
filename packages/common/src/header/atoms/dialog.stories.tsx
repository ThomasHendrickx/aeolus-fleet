import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Button } from './button.js';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog.js';

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
        <p className="text-body text-muted-foreground">The dialog's body: a form, a list or a message.</p>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button variant="primary">Rename ship</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};
