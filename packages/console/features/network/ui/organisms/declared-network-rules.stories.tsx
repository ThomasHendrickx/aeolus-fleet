import { idSchema, type LabelValueId, type ListedLabel } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { BLUEPRINT, labelContext, labelledFleet, OS, OWNERS } from '../../../../lib/fixtures/labels.fixtures';
import type { DeclaredRules } from '../../services/declared-rules';
import { DeclaredNetworkRules } from './declared-network-rules';

function valueOf(label: ListedLabel, value: string): LabelValueId {
  const found = label.values.find((each) => each.value === value);
  if (found === undefined) {
    throw new RangeError(`${label.key} has no value ${value}`);
  }
  return found.id;
}

const BY_SQUADRONS: DeclaredRules = {
  shipId: OWNERS.squadrons.id,
  declaredBy: 'squadrons',
  rules: [{ verb: 'send', from: [{ labelId: BLUEPRINT.id, value: '#' }], to: [{ labelId: BLUEPRINT.id, value: '#' }] }],
};
const BY_TRIERARCH_PLUGIN: DeclaredRules = {
  shipId: OWNERS.trierarchPlugin.id,
  declaredBy: 'trierarch-plugin',
  rules: [
    { verb: 'send', from: [{ labelId: OS.id, value: '*' }], to: [{ labelId: OS.id, value: '*' }] },
    { verb: 'send', from: [valueOf(OS, 'macos')], to: [] },
  ],
};

const meta = {
  title: 'Organisms/DeclaredNetworkRules',
  component: DeclaredNetworkRules,
  args: { declared: [BY_SQUADRONS, BY_TRIERARCH_PLUGIN], context: labelContext(labelledFleet()), onRetry: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DeclaredNetworkRules>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each plugin's rules apart, with the plugin that declared them; argo reads them and has nothing to edit. */
export const Declared: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('network-declared-by').map((by) => by.textContent)).toEqual(['Declared by squadrons', 'Declared by trierarch-plugin']);
    const [bySquadrons, byTrierarchPlugin] = canvas.getAllByTestId('network-declared-plugin');
    await expect(within(bySquadrons ?? canvasElement).getAllByTestId('network-declared-rule-from-value').map((chip) => chip.textContent)).toEqual(['blueprint=#']);
    await expect(within(byTrierarchPlugin ?? canvasElement).getAllByTestId('network-declared-rule')).toHaveLength(2);
    await expect(within(byTrierarchPlugin ?? canvasElement).getAllByTestId('network-declared-rule')[1]).toHaveTextContent('Every ship');
    await expect(canvas.queryAllByRole('button')).toHaveLength(0);
  },
};

/** A term on a label the fleet no longer has matches no ship, and says so. */
export const RemovedLabel: Story = {
  args: {
    declared: [{ ...BY_SQUADRONS, rules: [{ verb: 'send', from: [{ labelId: idSchema('label').parse('lbl_01m3tbfspe96yf1rnr4ankzz00'), value: '#' }], to: [{ labelId: BLUEPRINT.id, value: '#' }] }] }],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('network-declared-rule-from-unknown')).toHaveTextContent('A removed label');
  },
};

/** No plugin declares rules. */
export const NoneDeclared: Story = {
  args: { declared: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No plugin declares rules.')).toBeVisible();
  },
};

export const Loading: Story = { args: { declared: undefined } };

/** The fleet did not answer: the rest of Network stays, and Try again asks again. */
export const CouldNotRead: Story = {
  args: { declared: undefined, error: 'the fleet did not answer' },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Try again/ }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};
