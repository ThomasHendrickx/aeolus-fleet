import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { TabBar } from './tab-bar';

const meta = {
  title: 'Organisms/TabBar',
  component: TabBar,
  globals: { viewport: { value: 'mobile1' } },
} satisfies Meta<typeof TabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Phone only: switch the canvas to a phone viewport to see it. */
export const FleetActive: Story = {};
