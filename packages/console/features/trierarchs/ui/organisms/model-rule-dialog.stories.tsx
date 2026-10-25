import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import { ModelRuleDialog } from './model-rule-dialog';

const meta = {
  title: 'Organisms/ModelRuleDialog',
  component: ModelRuleDialog,
  args: { change: { model: 'claude-opus-5-5', kind: 'first' }, onOpenChange: fn(), isPending: false, onConfirm: fn() },
} satisfies Meta<typeof ModelRuleDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Enabling the first model: only enabled models are placed from then on. */
export const First: Story = {
  play: async ({ args }) => {
    // The dialog fades in: wait until it shows rather than check it at once.
    await waitFor(async () => {
      await expect(await screen.findByText('Allow only enabled models?')).toBeVisible();
    });
    await userEvent.click(await screen.findByTestId('model-rule-confirm'));
    await expect(args.onConfirm).toHaveBeenCalledOnce();
  },
};
/** Disabling the last enabled model: every model is allowed again. */
export const Last: Story = { args: { change: { model: 'claude-opus-5-5', kind: 'last' } } };
export const Enabling: Story = { args: { isPending: true } };
export const Refused: Story = { args: { error: 'the trierarch plugin did not answer: try again in a moment' } };
