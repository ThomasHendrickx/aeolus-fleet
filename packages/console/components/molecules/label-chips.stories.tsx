import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import type { LabelChip } from '../../lib/labels';
import { LabelChips } from './label-chips';

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
  title: 'Molecules/LabelChips',
  component: LabelChips,
  args: { chips: [chip('area=backend'), chip('project=aeolus')], width: 28 },
  decorators: [
    (Story) => (
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LabelChips>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two labels: both shown. */
export const Two: Story = {};
/** More than fit: the first two, then "+2", whose title names the rest. */
export const Folded: Story = {
  args: { chips: [chip('area=backend'), chip('project=aeolus'), chip('os=macos', 'trierarch-plugin'), chip('blueprint=aeolus-review', 'squadrons')] },
};
/** No labels: nothing. */
export const None: Story = { args: { chips: [] } };
