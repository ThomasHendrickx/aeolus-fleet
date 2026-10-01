import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Check, CircleX, Search } from 'lucide-react';

import { Input } from './input';
import { Label } from './label';

const meta = {
  title: 'Atoms/Input',
  component: Input,
  args: { id: 'ship-name', isMono: true, placeholder: 'e.g. reviewer-02' },
  decorators: [
    (Story) => (
      <div className="flex max-w-80 flex-col gap-1.5">
        <Label htmlFor="ship-name">Name</Label>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Placeholder: Story = {};
export const Filled: Story = { args: { defaultValue: 'auditor-01' } };
export const Focused: Story = { args: { defaultValue: 'auditor-01', autoFocus: true, trailingIcon: <Check /> } };
export const Invalid: Story = {
  args: {
    defaultValue: 'reviewer-01',
    'aria-invalid': true,
    'aria-describedby': 'ship-name-error',
    trailingIcon: <CircleX className="text-destructive-text" />,
  },
  decorators: [
    (Story) => (
      <>
        <Story />
        <p id="ship-name-error" className="text-meta text-destructive-text">
          reviewer-01 is already used by an active ship.
        </p>
      </>
    ),
  ],
};
export const Disabled: Story = { args: { isMono: false, disabled: true, defaultValue: 'operator@example.com' } };
export const LeadingIcon: Story = {
  args: { isMono: false, placeholder: 'Search ships by name', leadingIcon: <Search /> },
};
export const Touch: Story = { args: { size: 'touch', defaultValue: 'auditor-01' } };
