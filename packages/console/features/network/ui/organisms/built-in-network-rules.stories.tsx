import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { builtInRowsOf } from '../../services/built-in-rules';
import { BuiltInNetworkRules } from './built-in-network-rules';

const ALL_ON = builtInRowsOf([
  { rule: 'argo', isOn: true },
  { rule: 'owner', isOn: true },
  { rule: 'answer', isOn: true },
  { rule: 'viewerRead', isOn: true },
  { rule: 'open', verb: 'send', isOn: true },
  { rule: 'open', verb: 'read', isOn: true },
  { rule: 'open', verb: 'manage', isOn: true },
]);

/** argo's rules apply: the plugin turned open off for every verb; argo turned the viewer reading off. */
const WITH_RULES = ALL_ON.map((row) => (row.turnedBy === 'never' ? row : { ...row, isOn: false }));

const meta = {
  title: 'Organisms/BuiltInNetworkRules',
  component: BuiltInNetworkRules,
  args: { rows: ALL_ON, isTurning: false, onViewerReadChange: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BuiltInNetworkRules>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A fleet without rules: every built-in rule on, the fixed ones never off with no control. */
export const AllOn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('network-built-in-rule-name').map((name) => name.textContent)).toEqual([
      'argo',
      'Owner',
      'Answer',
      'Viewer reads',
      'Open for send',
      'Open for read',
      'Open for manage',
    ]);
    await expect(canvas.getAllByTestId('network-built-in-rule-state').slice(0, 3).map((state) => state.textContent)).toEqual(['Never off', 'Never off', 'Never off']);
    await expect(canvas.getAllByRole('switch')).toHaveLength(1);
  },
};
/** argo's rules apply: open off for every verb, the viewer reading off. */
export const WithRules: Story = { args: { rows: WITH_RULES } };
/** The switch turns the viewer reading. */
export const TurnsViewerRead: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('network-built-in-viewer-read'));
    await expect(args.onViewerReadChange).toHaveBeenCalledWith(false);
  },
};
export const Turning: Story = { args: { isTurning: true } };
export const TurnFailed: Story = { args: { turnError: 'Only argo turns the viewer reading on or off (decision 0034)' } };
export const Loading: Story = { args: { rows: undefined } };
export const ReadFailed: Story = { args: { rows: undefined, error: 'The fleet does not answer', onRetry: fn() } };
