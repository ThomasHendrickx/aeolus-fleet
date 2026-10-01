import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Skeleton } from './skeleton';

const meta = {
  title: 'Atoms/Skeleton',
  component: Skeleton,
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Line: Story = { args: { className: 'h-3 w-48' } };
export const Badge: Story = { args: { className: 'h-5.5 w-20' } };
export const Block: Story = { args: { className: 'h-20 w-80 rounded-lg' } };
export const TableRow: Story = {
  render: () => (
    <div className="flex h-(--size-row) items-center gap-8 px-4">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-5.5 w-20" />
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-16" />
    </div>
  ),
};
