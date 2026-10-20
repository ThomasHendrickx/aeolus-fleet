import { idSchema, NETWORK_RULES_MAX, SHIP_LABELS_MAX, type LabelValueId, type ListedLabel, type ListedShip } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent, within } from 'storybook/test';

import { AREA, labelContext, labelledFleet, OS, PROJECT } from '../../../../lib/fixtures/labels.fixtures';
import { NetworkRulesEditor } from './network-rules-editor';

function valueOf(label: ListedLabel, value: string): LabelValueId {
  const found = label.values.find((each) => each.value === value);
  if (found === undefined) {
    throw new RangeError(`${label.key} has no value ${value}`);
  }
  return found.id;
}

const FLEET = labelledFleet();

/** A person's ship, alice, who may own ships (decision 0045). */
function personShip(): ListedShip {
  const [argo] = FLEET;
  if (argo === undefined) {
    throw new RangeError('The labelled fleet has no argo');
  }
  return { ...argo, id: idSchema('ship').parse('shp_01m56nef0v036d0tne8wwna1ce'), name: 'alice', type: 'person', kind: 'person' };
}

const ALICE = personShip();
const CONTEXT = labelContext([...FLEET, ALICE]);
const RULES = [
  { verb: 'send' as const, from: [valueOf(PROJECT, 'hemma')], to: [valueOf(PROJECT, 'hemma')] },
  { verb: 'send' as const, from: [valueOf(AREA, 'review')], to: [valueOf(PROJECT, 'aeolus'), valueOf(AREA, 'backend')] },
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

/** No rules: every ship may send to, read and manage every ship, the default. */
export const AllToAll: Story = { args: { rules: null } };
/** Two rules in force. */
export const WithRules: Story = {};
/** An empty list: only the built-in rules hold. */
export const NoRuleAllows: Story = { args: { rules: [] } };
/** A rule names a value the fleet no longer has: that side matches no ship (decision 0034). */
export const RemovedLabel: Story = { args: { rules: [{ verb: 'send', from: [idSchema('labelValue').parse('lbv_01m4jtkdcqe51e0v00c76eec2d')], to: [] }] } };
/** As many rules as a fleet holds: no Add rule. */
export const AtLimit: Story = { args: { limits: { rulesMax: 2, selectorMax: SHIP_LABELS_MAX } } };
export const Saving: Story = { args: { isSaving: true } };
export const Saved: Story = { args: { savedNote: 'Draft saved. Nothing changes until it is applied.' } };
export const SaveFailed: Story = { args: { saveError: 'A fleet holds at most 200 network rules of its own, beside the ones its ships declared (decision 0037)' } };
/** Remove all rules empties the editor into all-to-all, for Save to keep as the draft. */
export const RemovingAll: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('network-rules-off'));
    await expect(within(canvasElement).getByTestId('network-rules-state')).toHaveTextContent('No rules');
  },
};
/** Terms of any and the same value (decision 0034): every macOS ship may message the ships of its own project, and review ships any project. */
export const WithTerms: Story = {
  args: {
    rules: [
      { verb: 'send', from: [valueOf(OS, 'macos'), { labelId: PROJECT.id, value: '#' }], to: [{ labelId: PROJECT.id, value: '#' }] },
      { verb: 'send', from: [valueOf(AREA, 'review')], to: [{ labelId: PROJECT.id, value: '*' }] },
    ],
  },
};
/** A same value taken off one side: the other side says it needs one too, and Save stays off as the fleet refuses it. */
export const SameValueOnOneSide: Story = {
  args: { rules: [{ verb: 'send', from: [{ labelId: PROJECT.id, value: '#' }], to: [{ labelId: PROJECT.id, value: '#' }] }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(canvas.getByTestId('network-rule-to')).getByRole('button', { name: 'Remove project=#' }));
    await expect(canvas.getByTestId('network-rule-from-problem')).toHaveTextContent('project=# needs project=# on the other side');
    await expect(canvas.getByTestId('network-rules-save')).toBeDisabled();
  },
};
/** A rule per verb (decision 0034), with owner terms (decision 0045): review ships send to aeolus, ships of one owner read each other, and alice's ships may be managed by review ships. */
export const WithVerbsAndOwners: Story = {
  args: {
    rules: [
      { verb: 'send', from: [valueOf(AREA, 'review')], to: [valueOf(PROJECT, 'aeolus')] },
      { verb: 'read', from: [{ owner: '#' }], to: [{ owner: '#' }] },
      { verb: 'manage', from: [valueOf(AREA, 'review')], to: [{ owner: ALICE.id }] },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('network-rule-verb').map((verb) => verb.textContent)).toEqual(['May send to', 'May read', 'May manage']);
    await expect(canvas.getAllByTestId('network-rule-to-owner').map((owner) => owner.textContent)).toEqual(['owner=#', 'owner=alice']);
  },
};
/** A rule turned to read saves as a read rule. */
export const ChangesTheVerb: Story = {
  args: { rules: [{ verb: 'send', from: [valueOf(AREA, 'review')], to: [] }] },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('network-rule-verb'));
    await userEvent.click(await screen.findByRole('option', { name: 'May read' }));
    await userEvent.click(canvas.getByTestId('network-rules-save'));
    await expect(args.onSave).toHaveBeenCalledWith([{ verb: 'read', from: [valueOf(AREA, 'review')], to: [] }]);
  },
};
