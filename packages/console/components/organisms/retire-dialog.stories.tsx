import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { RetireDialog } from './retire-dialog';

const meta = {
  title: 'Organisms/RetireDialog',
  component: RetireDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    shipName: 'reviewer-01',
    openDeliveries: 3,
    isCrewed: true,
    isOpen: true,
    onOpenChange: () => undefined,
    isPending: false,
    onConfirm: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="min-h-160">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RetireDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open deliveries: the typed confirm; type the name to enable the button. */
export const OpenDeliveries: Story = {};
export const CleanInbox: Story = { args: { shipName: 'planner', openDeliveries: 0, isCrewed: false } };
export const OneOpenDelivery: Story = { args: { openDeliveries: 1 } };
export const Retiring: Story = { args: { shipName: 'planner', openDeliveries: 0, isPending: true } };
export const Failed: Story = { args: { error: 'The server did not answer.' } };
