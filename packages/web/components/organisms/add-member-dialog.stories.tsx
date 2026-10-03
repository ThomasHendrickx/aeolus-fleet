import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { AddMemberDialog } from './add-member-dialog';

const meta = {
  title: 'Organisms/AddMemberDialog',
  component: AddMemberDialog,
  args: {
    squadronId: 'aeolus-a1b2c3',
    blueprint: 'aeolus v3',
    roles: [
      { role: 'planner', template: 'planner@2', checkInMinutes: 30, now: 1, inBlueprint: 1 },
      { role: 'implementer', template: 'implementer@3', checkInMinutes: 15, now: 2, inBlueprint: 2 },
      { role: 'tester', template: 'tester@3', checkInMinutes: 10, now: 1, inBlueprint: 1 },
    ],
    isOpen: true,
    onOpenChange: () => undefined,
    isPending: false,
    onSubmit: () => undefined,
  },
} satisfies Meta<typeof AddMemberDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PickRole: Story = {};
export const Adding: Story = { args: { isPending: true } };
export const Failed: Story = { args: { error: 'The squadron manager did not answer.' } };
