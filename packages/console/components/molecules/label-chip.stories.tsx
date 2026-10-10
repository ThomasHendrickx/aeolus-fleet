import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';

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

/**
 * The chip with its title taken away: many screen readers never read a
 * title, so the name it then has is what they announce (#577).
 */
function untitledChipIn(canvasElement: HTMLElement): HTMLElement {
  const chip = chipIn(canvasElement);
  chip.removeAttribute('title');
  return chip;
}

/** Yours: no mark, a solid edge; its accessible name says it is yours. */
export const Yours: Story = {
  play: async ({ canvasElement }) => {
    const chip = chipIn(canvasElement);
    await expect(chip.querySelector('svg')).toBeNull();
    await expect(getComputedStyle(chip).borderStyle).toBe('solid');
    await expect(untitledChipIn(canvasElement)).toHaveAccessibleName('project=hemma, by you');
  },
};
/** The trierarch plugin's: a ship wheel; its accessible name names the owner. */
export const ByTrierarchPlugin: Story = {
  args: { chip: { key: 'os', value: 'macos', mark: 'trierarch-plugin', ownerName: 'trierarch-plugin' } },
  play: async ({ canvasElement }) => {
    await expect(untitledChipIn(canvasElement)).toHaveAccessibleName('os=macos, by trierarch-plugin');
  },
};
/** Squadrons': boxes; its accessible name names the owner. */
export const BySquadrons: Story = {
  args: { chip: { key: 'blueprint', value: 'hemma-feature', mark: 'squadrons', ownerName: 'squadrons' } },
  play: async ({ canvasElement }) => {
    await expect(untitledChipIn(canvasElement)).toHaveAccessibleName('blueprint=hemma-feature, by squadrons');
  },
};
/** Any other owner's: the ship icon; its accessible name names the owner. */
export const ByAnotherShip: Story = {
  args: { chip: { key: 'cost', value: 'low', mark: 'ship', ownerName: 'orchestrator' } },
  play: async ({ canvasElement }) => {
    await expect(untitledChipIn(canvasElement)).toHaveAccessibleName('cost=low, by orchestrator');
  },
};
/** A label the fleet no longer has, as a reach refusal kept it: a crossed-out tag and a dashed edge, so it never looks like yours; its accessible name says so. */
export const Gone: Story = {
  args: { chip: { key: 'tier', value: 'gold', mark: 'gone', ownerName: '' } },
  play: async ({ canvasElement }) => {
    const chip = chipIn(canvasElement);
    await expect(chip.querySelector('svg')).not.toBeNull();
    await expect(getComputedStyle(chip).borderStyle).toBe('dashed');
    await expect(untitledChipIn(canvasElement)).toHaveAccessibleName('tier=gold, a label that no longer exists');
  },
};
/** In a filter: it ends in ×; the chip keeps its owner in its name, the × names what it removes. */
export const Removable: Story = {
  args: { onRemove: fn() },
  play: async ({ canvasElement }) => {
    await expect(untitledChipIn(canvasElement)).toHaveAccessibleName('project=hemma, by you');
    await expect(within(canvasElement).getByRole('button')).toHaveAccessibleName('Remove project=hemma');
  },
};
/** A long value truncates within its space. */
export const Long: Story = {
  args: { chip: { key: 'workspace', value: 'aeolus-fleet-infra-terraform-modules', mark: 'none', ownerName: 'argo' }, className: 'max-w-48' },
};
/** A term of a rule that is not a value, as `*` and `#` (decision 0034): its accessible name says what it means. */
export const RuleTerm: Story = {
  args: { chip: { key: 'project', value: '#', mark: 'none', ownerName: 'argo' }, meaning: 'The same value as the other side' },
  play: async ({ canvasElement }) => {
    await expect(untitledChipIn(canvasElement)).toHaveAccessibleName('project=#, by you. The same value as the other side');
  },
};
