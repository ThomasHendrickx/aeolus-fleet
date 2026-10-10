import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { LabelChip } from './label-chip';

const meta = {
  title: 'Molecules/LabelChip',
  component: LabelChip,
  args: { chip: { key: 'project', value: 'hemma', mark: 'none', ownerName: 'argo' } },
} satisfies Meta<typeof LabelChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Yours: no mark. */
export const Yours: Story = {};
/** The trierarch plugin's: a ship wheel. */
export const ByTrierarchPlugin: Story = { args: { chip: { key: 'os', value: 'macos', mark: 'trierarch-plugin', ownerName: 'trierarch-plugin' } } };
/** Squadrons': boxes. */
export const BySquadrons: Story = { args: { chip: { key: 'blueprint', value: 'hemma-feature', mark: 'squadrons', ownerName: 'squadrons' } } };
/** Any other owner's: the ship icon. */
export const ByAnotherShip: Story = { args: { chip: { key: 'cost', value: 'low', mark: 'ship', ownerName: 'orchestrator' } } };
/** A label the fleet no longer has, as a reach refusal kept it: no mark, and its title says so. */
export const Gone: Story = { args: { chip: { key: 'tier', value: 'gold', mark: 'gone', ownerName: '' } } };
/** In a filter: it ends in ×. */
export const Removable: Story = { args: { onRemove: fn() } };
/** A long value truncates within its space. */
export const Long: Story = {
  args: { chip: { key: 'workspace', value: 'aeolus-fleet-infra-terraform-modules', mark: 'none', ownerName: 'argo' }, className: 'max-w-48' },
};
