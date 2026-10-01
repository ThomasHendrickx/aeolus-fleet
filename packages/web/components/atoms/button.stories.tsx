import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Copy, Ellipsis, PanelLeft, Plus, Search, Send, SquarePen } from 'lucide-react';

import { Button } from './button';

const meta = {
  title: 'Atoms/Button',
  component: Button,
  args: { children: 'Commission ship', variant: 'primary', size: 'md', icon: <Plus /> },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const PrimaryDisabled: Story = { args: { disabled: true } };
export const PrimaryLoading: Story = { args: { isLoading: true } };

export const Secondary: Story = { args: { variant: 'secondary', children: 'Message', icon: <SquarePen /> } };
export const SecondaryDisabled: Story = { args: { ...Secondary.args, disabled: true } };
export const SecondaryLoading: Story = { args: { ...Secondary.args, isLoading: true } };

export const Ghost: Story = { args: { variant: 'ghost', children: 'Copy id', icon: <Copy /> } };
export const GhostDisabled: Story = { args: { ...Ghost.args, disabled: true } };
export const GhostLoading: Story = { args: { ...Ghost.args, isLoading: true } };

export const Destructive: Story = { args: { variant: 'destructive', children: 'Retire ship', icon: undefined } };
export const DestructiveDisabled: Story = { args: { ...Destructive.args, disabled: true } };
export const DestructiveLoading: Story = { args: { ...Destructive.args, isLoading: true } };

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs">Resend</Button>
      <Button size="sm" icon={<SquarePen />}>
        Compose
      </Button>
      <Button variant="primary" size="md" icon={<Plus />}>
        Commission ship
      </Button>
      <Button variant="primary" size="touch" icon={<Send />}>
        Send message
      </Button>
    </div>
  ),
};

export const IconOnly: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="xs" isIconOnly aria-label="More actions" icon={<Ellipsis />} />
      <Button size="sm" isIconOnly aria-label="More actions" icon={<Ellipsis />} />
      <Button variant="ghost" size="md" isIconOnly aria-label="Toggle sidebar" icon={<PanelLeft />} />
      <Button variant="ghost" size="touch" isIconOnly aria-label="Search" icon={<Search />} />
      <Button size="sm" isIconOnly aria-label="Loading" isLoading />
    </div>
  ),
};

export const FullWidthOnPhone: Story = {
  args: { variant: 'destructive', size: 'touch', className: 'w-full', children: 'Retire and abandon 3 deliveries' },
};

export const AsLink: Story = {
  args: {
    variant: 'secondary',
    nativeButton: false,
    render: ({ children, ...props }) => (
      <a href="#fleet" {...props}>
        {children}
      </a>
    ),
    children: 'Open fleet',
    icon: undefined,
  },
};
