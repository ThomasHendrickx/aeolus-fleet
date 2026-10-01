import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { Header } from './header';

const meta = {
  title: 'Organisms/Header',
  component: Header,
  args: { breadcrumb: 'Fleet overview', live: 'live', onCompose: fn() },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = {};
export const Reconnecting: Story = { args: { live: 'reconnecting' } };
export const Offline: Story = { args: { live: 'offline' } };

/** A page that offers no Compose. */
export const WithoutCompose: Story = { args: { onCompose: undefined } };
