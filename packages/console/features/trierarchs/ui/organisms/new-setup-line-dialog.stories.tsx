import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

import { JOINED } from '../../../../lib/fixtures/machines.fixtures';
import { NewSetupLineDialog } from './new-setup-line-dialog';

const meta = {
  title: 'Organisms/NewSetupLineDialog',
  component: NewSetupLineDialog,
  parameters: { layout: 'fullscreen' },
  args: { name: 'trierarch-mac', isOpen: true, onOpenChange: () => undefined, isPending: false, onConfirm: () => undefined },
  decorators: [
    (Story) => (
      <div className="min-h-160">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NewSetupLineDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The confirm: the old line stops working, and a running trierarch loses its crew. */
export const Confirm: Story = {
  play: async () => {
    // The dialog fades in: wait until each part shows rather than check it at once.
    await waitFor(async () => {
      await expect(await screen.findByRole('heading', { name: 'Get a new setup line for trierarch-mac?' })).toBeVisible();
    });
    await waitFor(async () => {
      await expect(screen.getByText(/The old setup line stops working\. A trierarch already running with it loses its crew/)).toBeVisible();
    });
    await waitFor(async () => {
      await expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
      await expect(screen.getByTestId('new-setup-line-confirm')).toBeVisible();
    });
    await expect(screen.getByTestId('new-setup-line-confirm')).toHaveTextContent('Get new setup line');
  },
};
export const Getting: Story = { args: { isPending: true } };
export const Failed: Story = { args: { error: 'This call needs the fleet:manage or crew:run scope.' } };

/** The new line, shown once, as the join dialog shows a joined machine's. */
export const Line: Story = {
  args: { setupLine: JOINED.setupLine },
  play: async () => {
    await expect(await screen.findByTestId('new-setup-line-setup-line')).toHaveTextContent(JOINED.setupLine);
    await expect(screen.getByTestId('new-setup-line-dialog')).toHaveTextContent('If you lose it, get a new setup line on trierarch-mac’s card.');
  },
};

/** A press on the confirm shows it working at once, before the answer comes, and can not run twice. */
export const PressShowsPending: Story = {
  render: function Render(args) {
    const [isPending, setIsPending] = useState(false);
    return (
      <NewSetupLineDialog
        {...args}
        isPending={isPending}
        onConfirm={() => {
          setIsPending(true);
        }}
      />
    );
  },
  play: async () => {
    await userEvent.click(await screen.findByTestId('new-setup-line-confirm'));
    await waitFor(async () => {
      await expect(screen.getByTestId('new-setup-line-confirm')).toHaveTextContent('Getting new setup line');
    });
    await expect(screen.getByTestId('new-setup-line-confirm')).toHaveAttribute('aria-disabled', 'true');
  },
};
