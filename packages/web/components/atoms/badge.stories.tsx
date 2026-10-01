import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { UserRound } from 'lucide-react';

import { Badge } from './badge';

const meta = {
  title: 'Atoms/Badge',
  component: Badge,
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Secondary: Story = { args: { variant: 'secondary', children: 'JSON · 156 bytes' } };
export const Outline: Story = { args: { variant: 'outline', children: 'Current' } };
export const Type: Story = { args: { variant: 'type', children: 'reviewer' } };
export const AnyShipOfType: Story = {
  args: { variant: 'type', children: 'any reviewer', className: 'text-muted-foreground' },
};
export const KindOperator: Story = {
  args: {
    variant: 'kind',
    children: (
      <>
        <UserRound aria-hidden />
        operator
      </>
    ),
  },
};
export const Count: Story = { args: { variant: 'count', children: 3 } };
export const CountAttention: Story = { args: { variant: 'count-attention', children: 2 } };
