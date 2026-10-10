import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import type { FilterGroup, FilterKey } from '../../lib/labels';
import type { TermChip } from '../../lib/network-rules';
import { LabelSelectorField } from './label-selector-field';

const values = (key: string, counts: Record<string, number>): FilterKey['values'] => Object.entries(counts).map(([value, shipCount]) => ({ valueId: `lbv_${key}_${value}`, value, shipCount }));

const GROUPS: FilterGroup[] = [
  {
    title: 'Yours',
    keys: [
      { labelId: 'lbl_team', key: 'team', mark: 'none', values: values('team', { ops: 3, research: 2 }) },
      { labelId: 'lbl_tier', key: 'tier', mark: 'none', values: values('tier', { sensitive: 1 }) },
    ],
  },
];

const chip = (key: string, value: string): TermChip => ({ labelId: `lbl_${key}`, key, value, mark: 'none', ownerName: 'argo', term: `lbv_${key}_${value}` });

const meta = {
  title: 'Molecules/LabelSelectorField',
  component: LabelSelectorField,
  args: { label: 'From ships with', picked: [], unknown: [], groups: GROUPS, max: 20, onAdd: fn(), onRemove: fn(), testId: 'network-rule-from', popoverTestId: 'network-rule-popover' },
  decorators: [
    (Story) => (
      <div className="w-120">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LabelSelectorField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** None picked: every ship. */
export const EveryShip: Story = {};
export const One: Story = { args: { picked: [chip('team', 'ops')] } };
/** Two values: a ship must carry both. */
export const Two: Story = { args: { picked: [chip('team', 'ops'), chip('tier', 'sensitive')] } };
/** As many as a selector holds: no Add label. */
export const AtLimit: Story = { args: { picked: [chip('team', 'ops'), chip('tier', 'sensitive')], max: 2 } };
/** A value the fleet no longer has: the side matches no ship until it goes (decision 0034). */
export const RemovedLabel: Story = { args: { picked: [chip('team', 'ops')], unknown: ['lbv_01m4jtkdcqe51e0v00c76eec2d'] } };
/** While saving: no ×, and Add label is off. */
export const Disabled: Story = { args: { picked: [chip('team', 'ops')], isDisabled: true } };
