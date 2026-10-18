import { NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS, NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS, WHILE_UNAVAILABLE } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { NetworkDeclarationForm } from './network-declaration-form';

const meta = {
  title: 'Organisms/NetworkDeclarationForm',
  component: NetworkDeclarationForm,
  args: {
    declaration: { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 },
    options: WHILE_UNAVAILABLE,
    bounds: { min: NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS, max: NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS },
    isSaving: false,
    onSave: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NetworkDeclarationForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What the plugin declares until argo sets it: keep the latest rules after 300 seconds. */
export const Default: Story = {};
export const BlockAll: Story = { args: { declaration: { whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 } } };
export const OpenAll: Story = { args: { declaration: { whileUnavailable: 'open-all', notRespondingAfterSeconds: 3600 } } };
export const Saving: Story = { args: { isSaving: true } };
export const Saved: Story = { args: { savedNote: 'Saved. The networking plugin registered again with it.' } };
export const SaveFailed: Story = { args: { saveError: 'the networking plugin did not answer: try again in a moment' } };
/** Fewer seconds than common allows: the hint says so and Save waits. */
export const TooShort: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.clear(canvas.getByTestId('network-declaration-seconds'));
    await userEvent.type(canvas.getByTestId('network-declaration-seconds'), '30');
    await expect(canvas.getByText('At least 60 seconds.')).toBeVisible();
    await expect(canvas.getByTestId('network-declaration-save')).toBeDisabled();
  },
};
