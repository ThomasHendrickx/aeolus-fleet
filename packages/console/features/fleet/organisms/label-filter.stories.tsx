import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { filterGroupsOf, pickedChips } from '../../../lib/labels';
import { PickedLabels } from './label-filter';
import { AREA, carried, labelContext, PROJECT } from '../../../lib/fixtures/labels.fixtures';

const CONTEXT = labelContext([]);
const PICKED = pickedChips([carried(PROJECT, 'hemma').valueId, carried(AREA, 'backend').valueId], CONTEXT);

const meta = {
  title: 'Organisms/LabelFilter',
  component: PickedLabels,
  args: { groups: filterGroupsOf(CONTEXT), picked: PICKED, onPick: fn(), onRemove: fn(), onClear: fn() },
} satisfies Meta<typeof PickedLabels>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two values picked (canvas LbOverviewFiltered): "Ships with project=hemma and area=backend", each with ×, Add and Clear labels. */
export const Picked: Story = {};
/** Nothing picked: no row. */
export const NothingPicked: Story = { args: { picked: [] } };
