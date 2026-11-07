import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Button } from '../atoms/button.js';
import { TypedConfirm } from './typed-confirm.js';

const meta = {
  title: 'Molecules/TypedConfirm',
  component: TypedConfirm,
  args: { expected: 'reviewer-01', value: '', onValueChange: fn() },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TypedConfirm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Mismatch: Story = { args: { value: 'reviewer-0' } };
export const Match: Story = { args: { value: 'reviewer-01' } };

/** Typing for real, with the action it unlocks. */
export const WithAction: Story = {
  render: function Render({ expected, onValueChange }) {
    const [value, setValue] = useState('');
    return (
      <div className="flex flex-col gap-3">
        <TypedConfirm
          expected={expected}
          value={value}
          onValueChange={(nextValue) => {
            onValueChange(nextValue);
            setValue(nextValue);
          }}
        />
        <Button variant="destructive" disabled={value !== expected}>
          Retire and abandon 3 deliveries
        </Button>
      </div>
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox');
    const action = canvas.getByRole('button', { name: 'Retire and abandon 3 deliveries' });

    await expect(action).toBeDisabled();
    await userEvent.type(input, args.expected);
    await expect(args.onValueChange).toHaveBeenLastCalledWith(args.expected);
    await expect(action).toBeEnabled();

    await userEvent.clear(input);
    await userEvent.type(input, 'reviewer-0');
    await expect(args.onValueChange).toHaveBeenLastCalledWith('reviewer-0');
    await expect(action).toBeDisabled();
  },
};
