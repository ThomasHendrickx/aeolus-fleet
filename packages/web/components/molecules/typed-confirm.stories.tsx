import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';

import { isTypedMatch } from '../../lib/ship-dialogs';
import { Button } from '../atoms/button';
import { TypedConfirm } from './typed-confirm';

const meta = {
  title: 'Molecules/TypedConfirm',
  component: TypedConfirm,
  args: { expected: 'reviewer-01', value: '', onValueChange: () => undefined },
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
  render: function Render({ expected }) {
    const [value, setValue] = useState('');
    return (
      <div className="flex flex-col gap-3">
        <TypedConfirm expected={expected} value={value} onValueChange={setValue} />
        <Button variant="destructive" disabled={!isTypedMatch(expected, value)}>
          Retire and abandon 3 deliveries
        </Button>
      </div>
    );
  },
};
