import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { LaunchNote } from './launch-note';

const meta = {
  title: 'Molecules/LaunchNote',
  component: LaunchNote,
  args: { note: 'Start in a worktree with Docker running.', model: 'claude-opus-5-5', template: 'implementer@3' },
} satisfies Meta<typeof LaunchNote>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoteAndModel: Story = {};
export const NoteOnly: Story = { args: { model: null } };
export const ModelOnly: Story = { args: { note: null } };
