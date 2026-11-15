import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Checkbox } from './checkbox.js';
import { Label } from './label.js';

function ShowRetiredShips({
  isChecked,
  isDisabled = false,
  isInvalid = false,
}: {
  isChecked: boolean;
  isDisabled?: boolean;
  isInvalid?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <Checkbox
        id="show-retired-ships"
        defaultChecked={isChecked}
        disabled={isDisabled}
        aria-invalid={isInvalid || undefined}
        data-testid="checkbox"
      />
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

/** Left unticked where it must be ticked: the invalid border and ring, as Input draws them. */
export const Invalid: Story = {
  args: { isChecked: false, isInvalid: true },
  play: async ({ canvasElement }) => {
    const checkbox = within(canvasElement).getByTestId('checkbox');
    const destructive = document.createElement('span');
    destructive.className = 'border border-destructive';
    canvasElement.append(destructive);

    await expect(checkbox).toHaveAttribute('aria-invalid', 'true');
    await expect(getComputedStyle(checkbox).borderTopColor).toBe(getComputedStyle(destructive).borderTopColor);
    await expect(getComputedStyle(checkbox).boxShadow).not.toBe('none');

    destructive.remove();
  },
};
