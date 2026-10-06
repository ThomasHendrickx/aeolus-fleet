import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { CopyButton } from './copy-button';

const meta = {
  title: 'Atoms/CopyButton',
  component: CopyButton,
  args: { value: 'shp_01j8xk4t9qf3m2n9xw5r6ryb4c', label: 'Copy ship id' },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Icon: Story = {};
export const Labeled: Story = { args: { isLabeled: true } };
export const Touch: Story = { args: { size: 'touch' } };
export const NextToAnId: Story = {
  render: (args) => (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-id" title={args.value}>
        shp_01J8XK4T…YB4C
      </span>
      <CopyButton {...args} />
    </span>
  ),
};
