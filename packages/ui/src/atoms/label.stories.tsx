import type { Meta, StoryObj } from '@storybook/react-vite';

import { Label } from './label.js';

const meta = {
  title: 'Atoms/Label',
  component: Label,
  args: { htmlFor: 'ship-name', children: 'Ship name' },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The visible name above a field. */
export const Default: Story = {};

/** Above its field, as every form shows it. */
export const AboveField: Story = {
  render: (args) => (
    <div className="flex flex-col gap-1.5">
      <Label {...args} />
      <input
        id="ship-name"
        className="h-9 rounded-md border border-border bg-background px-3 text-body"
        defaultValue="argo"
      />
    </div>
  ),
};
