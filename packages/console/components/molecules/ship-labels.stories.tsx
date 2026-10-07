import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import type { LabelChip } from '../../lib/labels';
import { ShipLabels } from './ship-labels';

const chip = (text: `${string}=${string}`, mark: LabelChip['mark'] = 'none'): LabelChip => {
  const [key = '', value = ''] = text.split('=');
  return {
    labelId: `lbl_${key}`,
    valueId: `lbv_${key}_${value}`,
    key,
    value,
    mark,
    ownerName: mark === 'none' ? 'argo' : mark,
  };
};

const meta = {
  title: 'Molecules/ShipLabels',
  component: ShipLabels,
  args: { chips: [chip('project=hemma'), chip('area=backend'), chip('blueprint=hemma-feature', 'squadrons')] },
} satisfies Meta<typeof ShipLabels>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A few: two shown, then "+1", which shows them all (canvas LbShipFew). */
export const Few: Story = {};
/** Two: both shown, nothing folded. */
export const Two: Story = { args: { chips: [chip('project=hemma'), chip('area=backend')] } };
/** No labels (canvas LbShipNone). */
export const None: Story = { args: { chips: [] } };
