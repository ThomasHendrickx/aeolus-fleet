import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ReleaseDialog } from './release-dialog';

const meta = {
  title: 'Organisms/ReleaseDialog',
  component: ReleaseDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    shipName: 'reviewer-01',
    sessionLocation: 'hetzner-1',
    inFlightCount: 1,
    isOpen: true,
    onOpenChange: () => undefined,
    isPending: false,
    onConfirm: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="min-h-128">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReleaseDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneInFlight: Story = {};
export const NothingInFlight: Story = { args: { inFlightCount: 0 } };
export const SeveralInFlight: Story = { args: { inFlightCount: 3 } };
export const UnknownLocation: Story = { args: { sessionLocation: null } };
export const Releasing: Story = { args: { isPending: true } };
export const Failed: Story = { args: { error: 'The server did not answer.' } };
export const Recrew: Story = { args: { mode: 'recrew' } };
export const Recrewing: Story = { args: { mode: 'recrew', isPending: true } };
export const RecrewFailed: Story = { args: { mode: 'recrew', error: 'The server did not answer.' } };
