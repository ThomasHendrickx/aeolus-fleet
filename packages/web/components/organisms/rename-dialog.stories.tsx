import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { RenameDialog } from './rename-dialog';

const meta = {
  title: 'Organisms/RenameDialog',
  component: RenameDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    shipName: 'reviewer-01',
    activeNames: ['reviewer-01', 'planner', 'tester-01'],
    isOpen: true,
    onOpenChange: () => undefined,
    isPending: false,
    onSubmit: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="min-h-180">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RenameDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty: the rule under the field. Type a new name, then the current name, to enable the button. */
export const Empty: Story = {};
export const Renaming: Story = { args: { isPending: true } };
export const Failed: Story = { args: { error: 'An active ship is already named planner.' } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
