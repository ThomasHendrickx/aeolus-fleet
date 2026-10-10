import { idSchema, NETWORK_RULES_MAX, SHIP_LABELS_MAX, type LabelValueId, type ListedLabel } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';

import { AREA, labelContext, labelledFleet, OS, PROJECT } from './labels.fixtures';
import { NetworkRulesEditor } from './network-rules-editor';

function valueOf(label: ListedLabel, value: string): LabelValueId {
  const found = label.values.find((each) => each.value === value);
  if (found === undefined) {
    throw new RangeError(`${label.key} has no value ${value}`);
  }
  return found.id;
}

const CONTEXT = labelContext(labelledFleet());
const RULES = [
  { from: [valueOf(PROJECT, 'hemma')], to: [valueOf(PROJECT, 'hemma')] },
  { from: [valueOf(AREA, 'review')], to: [valueOf(PROJECT, 'aeolus'), valueOf(AREA, 'backend')] },
];

const meta = {
  title: 'Organisms/NetworkRulesEditor',
  component: NetworkRulesEditor,
  args: { rules: RULES, context: CONTEXT, limits: { rulesMax: NETWORK_RULES_MAX, selectorMax: SHIP_LABELS_MAX }, isSaving: false, onSave: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NetworkRulesEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No rules: every ship may message every ship, the default. */
export const AllToAll: Story = { args: { rules: null } };
/** Two rules in force. */
export const WithRules: Story = {};
/** An empty list: only argo and answers get through. */
export const NoRuleAllows: Story = { args: { rules: [] } };
/** A rule names a value the fleet no longer has: that side matches no ship (decision 0034). */
export const RemovedLabel: Story = { args: { rules: [{ from: [idSchema('labelValue').parse('lbv_01m4jtkdcqe51e0v00c76eec2d')], to: [] }] } };
/** As many rules as a fleet holds: no Add rule. */
export const AtLimit: Story = { args: { limits: { rulesMax: 2, selectorMax: SHIP_LABELS_MAX } } };
export const Saving: Story = { args: { isSaving: true } };
export const Saved: Story = { args: { savedNote: 'Saved. The fleet enforces them from now on.' } };
/** Saved while the fleet does not answer: the plugin supplies them once it does. */
export const SavedWaiting: Story = { args: { savedNote: 'Saved. The fleet does not answer yet: the networking plugin supplies them as soon as it does.' } };
export const SaveFailed: Story = { args: { saveError: 'A fleet holds at most 200 network rules' } };
/** Remove all rules asks first: the rules are gone once confirmed. */
export const ConfirmingOff: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('network-rules-off'));
    // The dialog fades in: wait until it shows, as the other dialog stories do.
    await waitFor(async () => {
      await expect(await screen.findByTestId('network-rules-off-dialog')).toBeVisible();
    });
  },
};
/** Terms of any and the same value (decision 0034): every macOS ship may message the ships of its own project, and review ships any project. */
export const WithTerms: Story = {
  args: {
    rules: [
      { from: [valueOf(OS, 'macos'), { labelId: PROJECT.id, value: '#' }], to: [{ labelId: PROJECT.id, value: '#' }] },
      { from: [valueOf(AREA, 'review')], to: [{ labelId: PROJECT.id, value: '*' }] },
    ],
  },
};
/** A same value taken off one side: the other side says it needs one too, and Save stays off as the fleet refuses it. */
export const SameValueOnOneSide: Story = {
  args: { rules: [{ from: [{ labelId: PROJECT.id, value: '#' }], to: [{ labelId: PROJECT.id, value: '#' }] }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(canvas.getByTestId('network-rule-to')).getByRole('button', { name: 'Remove project=#' }));
    await expect(canvas.getByTestId('network-rule-from-problem')).toHaveTextContent('project=# needs project=# on the other side');
    await expect(canvas.getByTestId('network-rules-save')).toBeDisabled();
  },
};
