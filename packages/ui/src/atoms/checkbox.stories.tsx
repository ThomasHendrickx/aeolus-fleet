import type { Meta, StoryObj } from '@storybook/react-vite';

import { Checkbox } from './checkbox.js';
import { Label } from './label.js';

function ShowRetiredShips({ isChecked, isDisabled = false }: { isChecked: boolean; isDisabled?: boolean }) {
  return (
    <div className="inline-flex items-center gap-2">
      <Checkbox id="show-retired-ships" defaultChecked={isChecked} disabled={isDisabled} />
      <Label htmlFor="show-retired-ships" className="text-meta font-normal text-muted-foreground">
        Show retired ships
      </Label>
    </div>
  );
}

const meta = {
  title: 'Atoms/Checkbox',
  component: ShowRetiredShips,
} satisfies Meta<typeof ShowRetiredShips>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = { args: { isChecked: false } };
export const Checked: Story = { args: { isChecked: true } };
export const Disabled: Story = { args: { isChecked: false, isDisabled: true } };
