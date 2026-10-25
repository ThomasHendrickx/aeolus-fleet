import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import { CancelScheduleDialog } from './cancel-schedule-dialog';

const meta = {
  title: 'Organisms/CancelScheduleDialog',
  component: CancelScheduleDialog,
  args: { schedule: { recipient: 'To chief-of-staff', timing: 'Every 6 h' }, onOpenChange: fn(), isPending: false, onConfirm: fn() },
} satisfies Meta<typeof CancelScheduleDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Cancel a schedule: it sends nothing more and cannot be resumed. */
export const Default: Story = {
  play: async ({ args }) => {
    // The dialog fades in: wait until it shows rather than check it at once.
    await waitFor(async () => {
      await expect(await screen.findByText(/To chief-of-staff: Every 6 h\. It sends nothing more/)).toBeVisible();
    });
    await userEvent.click(await screen.findByTestId('cancel-schedule-confirm'));
    await expect(args.onConfirm).toHaveBeenCalledOnce();
  },
};

/** Cancelling while the server works: the confirm says so and takes no second press. */
export const Cancelling: Story = {
  args: { isPending: true },
  play: async ({ args }) => {
    const confirm = await screen.findByRole('button', { name: 'Cancelling…' });
    await waitFor(async () => {
      await expect(confirm).toBeVisible();
    });
    await expect(confirm).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(confirm, { pointerEventsCheck: 0 });
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

/** The server refused: the dialog stays open and says why. */
export const Refused: Story = {
  args: { error: 'The schedule already ended' },
  play: async () => {
    await waitFor(async () => {
      await expect(await screen.findByText('The schedule already ended. Nothing changed: try again.')).toBeVisible();
    });
  },
};
