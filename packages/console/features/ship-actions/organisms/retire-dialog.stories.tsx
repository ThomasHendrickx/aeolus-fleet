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
/** A ship carrying labels (canvas LbRetireShip): they are removed with it. */
export const WithLabels: Story = {
  args: { shipName: 'reviewer-2', openDeliveries: 1, labelLines: ['Its 3 labels are removed with it: project=aeolus, area=review, cost=low.'] },
};
/** An owner of labels (canvas LbRetireOwner): they retire with it, off the ships that carry them. */
export const OwnerOfLabels: Story = {
  args: {
    shipName: 'trierarch-plugin',
    openDeliveries: 0,
    labelLines: [
      'Its 3 labels retire with it: os, arch and site. Nobody can assign them again.',
      'They are removed from the 3 ships that carry them: trierarch-mac, trierarch-hetzner and trierarch-macbook.',
    ],
  },
};
