import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { LiveStatus } from './live-status';

const meta = {
  title: 'Molecules/LiveStatus',
  component: LiveStatus,
} satisfies Meta<typeof LiveStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = { args: { state: 'live' } };
export const Reconnecting: Story = { args: { state: 'reconnecting' } };
export const Offline: Story = { args: { state: 'offline' } };
