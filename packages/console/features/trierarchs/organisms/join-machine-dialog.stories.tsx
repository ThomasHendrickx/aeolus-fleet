import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { JOINED } from '../../../lib/fixtures/machines.fixtures';
import { JoinMachineDialog } from './join-machine-dialog';

const meta = {
  title: 'Organisms/JoinMachineDialog',
  component: JoinMachineDialog,
  parameters: { layout: 'fullscreen' },
  args: { activeNames: ['trierarch-mac'], isOpen: true, onOpenChange: () => undefined, isPending: false, onSubmit: () => undefined },
  decorators: [
    (Story) => (
      <div className="min-h-160">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof JoinMachineDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Name: Story = {};
export const Joining: Story = { args: { isPending: true } };
export const Failed: Story = { args: { error: 'A ship named trierarch-mac exists.' } };
export const Joined: Story = { args: { joined: JOINED } };
