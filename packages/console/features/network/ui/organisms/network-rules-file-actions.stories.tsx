import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { NetworkRulesFileActions } from './network-rules-file-actions';

const meta = {
  title: 'Organisms/NetworkRulesFileActions',
  component: NetworkRulesFileActions,
  args: { isExporting: false, onExport: fn(), canImport: true, onImport: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NetworkRulesFileActions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Export and Import, for a session holding fleet:network and labels:define. */
export const Idle: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('network-rules-export'));
    await expect(args.onExport).toHaveBeenCalledOnce();
    await userEvent.click(within(canvasElement).getByTestId('network-rules-import'));
    await expect(args.onImport).toHaveBeenCalledOnce();
  },
};
/** The export pending: the button says so and Import waits. */
export const Exporting: Story = {
  args: { isExporting: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('network-rules-export')).toHaveTextContent('Exporting…');
    await expect(within(canvasElement).getByTestId('network-rules-import')).toBeDisabled();
  },
};
/** The export failed: nothing was downloaded. */
export const ExportFailed: Story = { args: { exportError: 'This call needs the fleet:network scope' } };
/** The export left rules out: it says which and why, never silently. */
export const LeftOut: Story = {
  args: {
    exported: {
      name: 'network-rules-staging-v42.json',
      leftOut: [
        { rule: 2, reason: 'uses a label that no longer exists (its definer retired or deleted it)' },
        { rule: 5, reason: 'names a ship that no longer exists' },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('network-rules-left-out')).toHaveTextContent('rule 2 uses a label that no longer exists (its definer retired or deleted it)');
  },
};
/** Without labels:define, Import is not offered. */
export const ExportOnly: Story = {
  args: { canImport: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('network-rules-import')).toBeNull();
  },
};
