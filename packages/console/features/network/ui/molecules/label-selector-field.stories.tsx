import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';

import type { FilterGroup, FilterKey } from '../../../../lib/labels';
import type { OwnerChip, OwnerChoice, TermChip } from '../../../../lib/network-rules';
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

const term = (key: string, value: '*' | '#'): TermChip => ({ labelId: `lbl_${key}`, key, value, mark: 'none', ownerName: 'argo', term: { labelId: `lbl_${key}`, value } });

const ALICE = 'shp_01m56nef0v036d0tne8wwna1ce';

const OWNER_CHOICES: OwnerChoice[] = [
  { shipId: 'shp_01m56nef0v036d0tne8wwna560', name: 'argo' },
  { shipId: ALICE, name: 'alice' },
];

const owner = (value: string, text: string): OwnerChip => ({ term: { owner: value === 'alice' ? ALICE : value === '*' ? '*' : '#' }, text });

const meta = {
  title: 'Molecules/LabelSelectorField',
  component: LabelSelectorField,
  args: { label: 'From ships with', picked: [], owners: [], ownerChoices: OWNER_CHOICES, unknown: [], groups: GROUPS, max: 20, onAdd: fn(), onRemove: fn(), testId: 'network-rule-from', popoverTestId: 'network-rule-popover' },
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
/** Any value of a key, beside an exact value of another (decision 0034). */
export const AnyValue: Story = { args: { picked: [term('team', '*'), chip('tier', 'sensitive')] } };
/** The same value as the other side: a ship on each side carries a team value the other carries too. */
export const SameValue: Story = { args: { picked: [term('team', '#')] } };
/** A same value the other side lacks: said under the side, as the fleet refuses it. */
export const SameValueAlone: Story = {
  args: { picked: [term('tier', '#')], problem: 'tier=# needs tier=# on the other side: # matches the same value there.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('network-rule-from-problem')).toHaveTextContent('tier=# needs tier=# on the other side');
  },
};
/** Add label offers a key's any value and same value before its values, and hands the term over. */
export const PicksATerm: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('network-rule-from-add'));
    const popover = await screen.findByTestId('network-rule-popover');
    await userEvent.click(await within(popover).findByRole('button', { name: /^team/ }));
    await userEvent.click(within(popover).getByTestId('label-picker-same'));
    await waitFor(async () => {
      await expect(args.onAdd).toHaveBeenCalledWith({ labelId: 'lbl_team', value: '#' });
    });
  },
};
/** Owner terms (decision 0045): the ships alice owns, beside a label value. */
export const Owner: Story = { args: { picked: [chip('team', 'ops')], owners: [owner('alice', 'owner=alice')] } };
/** The same owner as the other side, and any owner. */
export const SameOwner: Story = { args: { owners: [owner('#', 'owner=#'), owner('*', 'owner=*')] } };
/** An owner ship the fleet no longer has: the side matches no ship until it goes. */
export const RemovedOwner: Story = { args: { unknown: [{ owner: 'shp_01m56nef0v036d0tne8wwn6040' }] } };
/** Add owner offers any owner, the same owner and each owner ship, and hands the term over; one picked is off. */
export const PicksAnOwner: Story = {
  args: { owners: [owner('*', 'owner=*')] },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('network-rule-from-owner-add'));
    const popover = await screen.findByTestId('network-rule-popover-owner');
    await expect(within(popover).getByRole('button', { name: 'Any owner' })).toBeDisabled();
    await userEvent.click(within(popover).getByRole('button', { name: 'alice' }));
    await waitFor(async () => {
      await expect(args.onAdd).toHaveBeenCalledWith({ owner: ALICE });
    });
  },
};
