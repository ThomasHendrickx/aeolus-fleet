import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Header } from './header';

const meta = {
  title: 'Organisms/Header',
  component: Header,
  args: { breadcrumb: 'Fleet overview', live: 'live' },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = {};
export const Reconnecting: Story = { args: { live: 'reconnecting' } };
export const Offline: Story = { args: { live: 'offline' } };
