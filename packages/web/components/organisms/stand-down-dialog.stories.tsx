import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { StandDownDialog } from './stand-down-dialog';

const meta = {
  title: 'Organisms/StandDownDialog',
  component: StandDownDialog,
  args: { squadronId: 'aeolus-a1b2c3', memberCount: 4, openDeliveries: 3, inFlightDeliveries: 1, isOpen: true, onOpenChange: () => undefined, isPending: false, onConfirm: () => undefined },
} satisfies Meta<typeof StandDownDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Confirm: Story = {};
export const StandingDown: Story = { args: { isPending: true } };
export const Failed: Story = { args: { error: 'The squadron manager did not answer.' } };
export const Force: Story = { args: { isForced: true } };
export const ForceNoOpenWork: Story = { args: { isForced: true, openDeliveries: 0, inFlightDeliveries: 0 } };
export const ForceFailed: Story = { args: { isForced: true, error: 'The squadron manager did not answer.' } };
