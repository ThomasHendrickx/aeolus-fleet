import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Button } from './button';
import { Separator } from './separator';

const meta = {
  title: 'Atoms/Separator',
  component: Separator,
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: () => (
    <div className="flex w-60 flex-col gap-2 text-body">
      <span>Copy ship id</span>
      <Separator />
      <span className="text-destructive-text">Retire ship…</span>
    </div>
  ),
};

export const VerticalInToolbar: Story = {
  render: () => (
    <div className="flex h-8 items-center gap-2">
      <Button size="sm">Filter</Button>
      <Separator orientation="vertical" />
      <Button size="sm" variant="ghost">
        Clear
      </Button>
    </div>
  ),
};
