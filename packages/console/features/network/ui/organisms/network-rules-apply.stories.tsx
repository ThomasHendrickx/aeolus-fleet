import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';

import { NetworkRulesApply } from './network-rules-apply';

const meta = {
  title: 'Organisms/NetworkRulesApply',
  component: NetworkRulesApply,
  args: { draft: { savedAgainstVersion: 3 }, appliedVersion: 3, isApplying: false, onApply: fn(), isDiscarding: false, onDiscard: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NetworkRulesApply>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No draft: nothing to apply. */
export const NoDraft: Story = { args: { draft: null } };
/** A draft saved against the version in force. */
export const WithDraft: Story = {};
/** The settings moved since the draft was saved: it says so. */
export const SettingsMoved: Story = {
  args: { appliedVersion: 5 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('network-rules-apply-moved')).toHaveTextContent('The settings moved from version 3 since the draft was saved.');
  },
};
/** Apply asks first, and applies once confirmed. */
export const Confirming: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('network-rules-apply-open'));
    // The dialog fades in: wait until it shows, as the other dialog stories do.
    await waitFor(async () => {
      await expect(await screen.findByTestId('network-rules-apply-dialog')).toBeVisible();
    });
    await userEvent.click(screen.getByTestId('network-rules-apply-confirm'));
    await expect(args.onApply).toHaveBeenCalledOnce();
  },
};
/** Discard asks first, and discards once confirmed. */
export const ConfirmingDiscard: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('network-rules-discard-open'));
    await waitFor(async () => {
      await expect(await screen.findByTestId('network-rules-discard-dialog')).toBeVisible();
    });
    await userEvent.click(screen.getByTestId('network-rules-discard-confirm'));
    await expect(args.onDiscard).toHaveBeenCalledOnce();
  },
};
export const Applying: Story = { args: { isApplying: true } };
export const Discarding: Story = { args: { isDiscarding: true } };
export const DiscardFailed: Story = { args: { discardError: 'The fleet has no draft of its network rules' } };
export const ApplyFailed: Story = { args: { applyError: 'The network settings are at version 4 now, not 3: look at the draft again before applying it' } };
