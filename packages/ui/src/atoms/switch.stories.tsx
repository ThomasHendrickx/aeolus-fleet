import type { Meta, StoryObj } from '@storybook/react-vite';

import { Label } from './label.js';
import { Switch } from './switch.js';

function ShowRetired({ isChecked, isDisabled = false }: { isChecked: boolean; isDisabled?: boolean }) {
  return (
    <div className="inline-flex items-center gap-2">
      <Switch id="show-retired" defaultChecked={isChecked} disabled={isDisabled} />
      <Label htmlFor="show-retired" className="text-meta font-normal text-muted-foreground">
        Show retired (1)
      </Label>
    </div>
  );
}

const meta = {
  title: 'Atoms/Switch',
  component: ShowRetired,
} satisfies Meta<typeof ShowRetired>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = { args: { isChecked: false } };
export const On: Story = { args: { isChecked: true } };
export const Disabled: Story = { args: { isChecked: false, isDisabled: true } };
