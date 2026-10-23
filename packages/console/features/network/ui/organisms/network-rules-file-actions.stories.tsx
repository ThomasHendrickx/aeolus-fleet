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
/** Without labels:define, Import is not offered. */
export const ExportOnly: Story = {
  args: { canImport: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('network-rules-import')).toBeNull();
  },
};
