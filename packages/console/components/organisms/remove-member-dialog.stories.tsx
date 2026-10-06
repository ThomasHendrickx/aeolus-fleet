import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { RemoveMemberDialog } from './remove-member-dialog';

const meta = {
  title: 'Organisms/RemoveMemberDialog',
  component: RemoveMemberDialog,
  args: {
    squadronId: 'aeolus-a1b2c3',
    member: { name: 'implementer-q8r2', role: 'implementer' },
    othersOfRole: ['implementer-k3m9'],
    blueprint: { label: 'aeolus v3', count: 2 },
    openDeliveries: 0,
    inFlightDeliveries: 0,
    isOpen: true,
    onOpenChange: () => undefined,
    isPending: false,
    onConfirm: () => undefined,
  },
} satisfies Meta<typeof RemoveMemberDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CleanInbox: Story = {};
export const LastOfRole: Story = { args: { member: { name: 'tester-x4p1', role: 'tester' }, othersOfRole: [], blueprint: { label: 'aeolus v3', count: 1 } } };
export const OpenDeliveries: Story = { args: { openDeliveries: 2, inFlightDeliveries: 0 } };
export const Removing: Story = { args: { openDeliveries: 2, isPending: true } };
export const Failed: Story = { args: { error: 'The squadron manager did not answer.' } };
