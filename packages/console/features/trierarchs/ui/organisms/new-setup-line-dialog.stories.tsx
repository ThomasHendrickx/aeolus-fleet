import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

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
const REASON = 'This call needs the fleet:manage or crew:run scope.';

/** Nothing went through: the confirm says so, and the old line still works. */
export const Failed: Story = {
  args: { error: { reason: REASON, outcome: 'unchanged' } },
  play: async () => {
    // The dialog fades in: wait until it shows rather than check it at once.
    await waitFor(async () => {
      await expect(await screen.findByText('Couldn’t get a new setup line')).toBeVisible();
    });
    await expect(screen.getByText(`${REASON} Nothing changed.`)).toBeVisible();
  },
};

/** The release went through, the new line did not (trierarch#260): the confirm says the ship was released and to get a new line again. */
export const FailedAfterRelease: Story = {
  args: { error: { reason: REASON, outcome: 'released' } },
  play: async () => {
    // The dialog fades in: wait until it shows rather than check it at once.
    await waitFor(async () => {
      await expect(await screen.findByText('Couldn’t get a new setup line')).toBeVisible();
    });
    await expect(
      screen.getByText(`${REASON} trierarch-mac was released, but has no new setup line yet: its old line stopped working and its trierarch lost its crew. Get a new setup line again, here or on its card, and run it on the machine.`),
    ).toBeVisible();
    await expect(screen.getByTestId('new-setup-line-dialog')).not.toHaveTextContent('Nothing changed');
  },
};

/** Whether the release went through could not be read again: the confirm says it may have, and what to do. */
export const FailedMaybeReleased: Story = {
  args: { error: { reason: REASON, outcome: 'unsure' } },
  play: async () => {
    // The dialog fades in: wait until it shows rather than check it at once.
    await waitFor(async () => {
      await expect(await screen.findByText('Couldn’t get a new setup line')).toBeVisible();
    });
    await expect(
      screen.getByText(`${REASON} trierarch-mac may have been released: if so, its old line stopped working and its trierarch lost its crew. Get a new setup line again, here or on its card, and run it on the machine.`),
    ).toBeVisible();
    await expect(screen.getByTestId('new-setup-line-dialog')).not.toHaveTextContent('Nothing changed');
  },
};

const STDIN_LINE = "bash <(curl -fsSL https://raw.githubusercontent.com/ThomasHendrickx/aeolus-fleet-trierarch/main/install.sh) --fleet-url https://fleet.example.com --ship-id shp_01j9k2t4qzr3a9w6m2v5n7trnw --secret-stdin <<< 'aeolus_sk_v1_example'";

const writeClipboard = fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);

/** The new line, shown once, as the join dialog shows a joined machine's. */
export const Line: Story = {
  args: { setupLine: JOINED.setupLine },
  beforeEach: () => {
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    writeClipboard.mockClear();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: writeClipboard } });
    return () => {
      if (clipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard');
      else Object.defineProperty(navigator, 'clipboard', clipboard);
    };
  },
  play: async () => {
    // Given a replacement setup line has been issued.
    // When the console shows it, before it is run on the computer.
    await expect((await screen.findByTestId('new-setup-line-setup-line')).textContent).toBe(STDIN_LINE);
    await userEvent.click(screen.getByTestId('new-setup-line-setup-line-copy'));
    await expect(writeClipboard).toHaveBeenCalledWith(STDIN_LINE);
    await expect(screen.getByTestId('new-setup-line-setup-line-copy')).toHaveTextContent('Copied');
    // Then the same approved introduction explains setup and distinguishes npm's confirmation from setup choices.
    await waitFor(async () => { await expect(screen.getByText('This installs the trierarch, which runs agent sessions on this computer. Setup explains permissions, workspaces, limits and starting the background service. If your line uses npm, npm may first ask to download the trierarch package; that confirmation installs the package and does not answer the setup choices.')).toBeVisible(); });
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

/** Clipboard refusal keeps the approved stdin line available to copy by hand. */
export const LineCopyFailed: Story = {
  args: { setupLine: JOINED.setupLine },
  beforeEach: () => {
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Clipboard unavailable')) } });
    return () => {
      if (clipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard');
      else Object.defineProperty(navigator, 'clipboard', clipboard);
    };
  },
  play: async () => {
    // Given the replacement line is shown and the clipboard refuses access.
    const copy = await screen.findByTestId('new-setup-line-setup-line-copy');
    // When Copy is pressed.
    await userEvent.click(copy);
    // Then the failure explains how to copy the exact line by hand.
    await waitFor(async () => { await expect(screen.getByText('Could not copy: select the text and copy it by hand.')).toBeVisible(); });
    await expect(screen.getByTestId('new-setup-line-setup-line').textContent).toBe(STDIN_LINE);
  },
};
