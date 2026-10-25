import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { SquadronsNotConnected } from './squadrons-not-connected';

const meta = {
  title: 'Molecules/SquadronsNotConnected',
  component: SquadronsNotConnected,
} satisfies Meta<typeof SquadronsNotConnected>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotConnected: Story = {};
