import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { Sidebar } from './sidebar';

const meta = {
  title: 'Organisms/Sidebar',
  component: Sidebar,
  args: { onSignOut: fn() },
  decorators: [
    (Story) => (
      <div className="-m-6 flex min-h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Full width from 1024 px; narrower canvases show the 64 px rail. */
export const OverviewActive: Story = {};
