import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { FailedScopesRead } from './failed-scopes-read';

/** Ends the read the last Try again started. */
let answerRead: () => void = () => undefined;

const meta = {
  title: 'Molecules/FailedScopesRead',
  component: FailedScopesRead,
  args: {
    plugin: 'the trierarch plugin',
    shipName: 'trierarch-plugin',
    reason: 'The fleet did not answer',
    onRetry: fn(
      () =>
        new Promise<void>((resolve) => {
          answerRead = resolve;
        }),
    ),
  },
} satisfies Meta<typeof FailedScopesRead>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Failed: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Try again' })).not.toHaveAttribute('aria-busy', 'true');
  },
};

/** Pressing Try again shows the button working until the read answers, then Try again is offered again. */
export const Retrying: Story = {
  play: async ({ canvasElement, args }) => {
    // Given the failed read
    const canvas = within(canvasElement);

    // When the operator presses Try again
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));

    // Then the button shows it is working
    await expect(args.onRetry).toHaveBeenCalledOnce();
    await expect(canvas.getByRole('button', { name: 'Trying again…' })).toHaveAttribute('aria-busy', 'true');

    // And when the read answers, Try again is offered again
    answerRead();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Try again' })).not.toHaveAttribute('aria-busy', 'true'));
  },
};
