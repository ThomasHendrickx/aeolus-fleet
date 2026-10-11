import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { labelRowsOf } from '../../../lib/labels';
import { LabelValuesDialog } from './label-values-dialog';
import { labelContext, labelledFleet } from '../../../lib/fixtures/labels.fixtures';

const PROJECT_ROW = labelRowsOf(labelContext(labelledFleet())).find((row) => row.key === 'project');
const HEMMA = PROJECT_ROW?.values.find((value) => value.value === 'hemma');

const meta = {
  title: 'Organisms/LabelValuesDialog',
  component: LabelValuesDialog,
  args: { row: PROJECT_ROW, onOpenChange: fn(), onAdd: fn(), onRemove: fn() },
} satisfies Meta<typeof LabelValuesDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each value with the ships that carry it and ×; Add a value (canvas LbValues). Changes apply at once. */
export const Default: Story = {};
/** A value being removed. */
export const Removing: Story = { args: { busy: HEMMA === undefined ? undefined : { action: 'remove', valueId: HEMMA.valueId } } };
/** Removing a value ships carry (canvas LbValuesRefused): the server names them, under that value. */
export const RemoveRefused: Story = {
  args: { error: { valueId: HEMMA?.valueId, value: 'hemma', message: 'Ships carry project=hemma: hemma-api, hemma-web' } },
};
/** A value the server refused to add, under the field. */
export const AddRefused: Story = { args: { error: { value: 'research', message: 'A label has 1 to 50 values (decision 0031)' } } };
/** On phone (canvas LbMValues). */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
