import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { labelRowsOf } from '../../../lib/labels';
import { DeleteLabelDialog } from './delete-label-dialog';
import { labelContext, labelledFleet } from '../../../lib/fixtures/labels.fixtures';

const COST_ROW = labelRowsOf(labelContext(labelledFleet())).find((row) => row.key === 'cost');

const meta = {
  title: 'Organisms/DeleteLabelDialog',
  component: DeleteLabelDialog,
  args: { row: COST_ROW, onOpenChange: fn(), isPending: false, onDelete: fn() },
} satisfies Meta<typeof DeleteLabelDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Delete a label no ship carries: its values go with it. */
export const Default: Story = {};
export const Deleting: Story = { args: { isPending: true } };
/** A ship took it meanwhile: the server refuses, naming the ships. */
export const Refused: Story = { args: { error: 'Ships carry the label cost: hemma-web' } };
