import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import { LabelChip } from './label-chip';

const meta = {
  title: 'Molecules/LabelChip',
  component: LabelChip,
  args: { chip: { key: 'project', value: 'hemma', mark: 'none', ownerName: 'argo' } },
} satisfies Meta<typeof LabelChip>;

export default meta;
type Story = StoryObj<typeof meta>;

function chipIn(canvasElement: HTMLElement): HTMLElement {
  const chip = canvasElement.querySelector<HTMLElement>('[data-slot="label-chip"]');
  if (chip === null) {
    throw new Error('no label chip rendered');
  }
  return chip;
}

/** Yours: no mark, a solid edge. */
export const Yours: Story = {
  play: async ({ canvasElement }) => {
    const chip = chipIn(canvasElement);
    await expect(chip.querySelector('svg')).toBeNull();
    await expect(getComputedStyle(chip).borderStyle).toBe('solid');
  },
};
/** The trierarch plugin's: a ship wheel. */
export const ByTrierarchPlugin: Story = { args: { chip: { key: 'os', value: 'macos', mark: 'trierarch-plugin', ownerName: 'trierarch-plugin' } } };
/** Squadrons': boxes. */
export const BySquadrons: Story = { args: { chip: { key: 'blueprint', value: 'hemma-feature', mark: 'squadrons', ownerName: 'squadrons' } } };
/** Any other owner's: the ship icon. */
export const ByAnotherShip: Story = { args: { chip: { key: 'cost', value: 'low', mark: 'ship', ownerName: 'orchestrator' } } };
/** A label the fleet no longer has, as a reach refusal kept it: a crossed-out tag and a dashed edge, so it never looks like yours; its title says so. */
export const Gone: Story = {
  args: { chip: { key: 'tier', value: 'gold', mark: 'gone', ownerName: '' } },
  play: async ({ canvasElement }) => {
    const chip = chipIn(canvasElement);
    await expect(chip.querySelector('svg')).not.toBeNull();
    await expect(getComputedStyle(chip).borderStyle).toBe('dashed');
  },
};
/** In a filter: it ends in ×. */
export const Removable: Story = { args: { onRemove: fn() } };
/** A long value truncates within its space. */
export const Long: Story = {
  args: { chip: { key: 'workspace', value: 'aeolus-fleet-infra-terraform-modules', mark: 'none', ownerName: 'argo' }, className: 'max-w-48' },
};
