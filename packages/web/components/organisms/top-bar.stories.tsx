import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Plus } from 'lucide-react';

import { Button } from '../atoms/button';
import { TopBar } from './top-bar';

const meta = {
  title: 'Organisms/TopBar',
  component: TopBar,
  args: { title: 'Fleet', live: 'live' },
  globals: { viewport: { value: 'mobile1' } },
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Root: Story = {};
export const Detail: Story = { args: { title: 'reviewer-01', back: { href: '/', label: 'Fleet' } } };
export const Offline: Story = { args: { live: 'offline' } };
export const WithAction: Story = {
  args: {
    actions: (
      <Button variant="ghost" size="touch" isIconOnly aria-label="Commission ship" icon={<Plus aria-hidden />} />
    ),
  },
};
