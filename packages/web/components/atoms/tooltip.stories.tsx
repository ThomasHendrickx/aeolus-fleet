import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Moon } from 'lucide-react';

import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

const meta = {
  title: 'Atoms/Tooltip',
  component: Tooltip,
  decorators: [
    (Story) => (
      <div className="flex min-h-32 items-end pl-24">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const IconButton: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger
        render={<Button variant="ghost" size="sm" isIconOnly aria-label="Toggle light and dark mode" icon={<Moon />} />}
      />
      <TooltipContent>Toggle light and dark mode</TooltipContent>
    </Tooltip>
  ),
};

export const TruncatedId: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger render={<span className="font-mono text-id" />}>shp_01J8XK4T…YB4C</TooltipTrigger>
      <TooltipContent>shp_01J8XK4T9QF3M2N9XW5R6YB4C</TooltipContent>
    </Tooltip>
  ),
};
