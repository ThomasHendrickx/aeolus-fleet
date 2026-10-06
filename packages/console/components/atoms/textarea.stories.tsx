import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Label } from './label';
import { Textarea } from './textarea';

const meta = {
  title: 'Atoms/Textarea',
  component: Textarea,
  args: { id: 'note', placeholder: 'What this ship is for' },
  decorators: [
    (Story) => (
      <div className="flex max-w-120 flex-col gap-1.5">
        <Label htmlFor="note">Note</Label>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Placeholder: Story = {};
export const Note: Story = { args: { defaultValue: 'Reviews pull requests on the console package.' } };
export const Payload: Story = {
  args: { isMono: true, rows: 6, defaultValue: '{\n  "task": "review",\n  "repo": "web",\n  "pr": 321\n}' },
};
export const Invalid: Story = { args: { 'aria-invalid': true, defaultValue: 'x'.repeat(80) } };
export const Disabled: Story = { args: { disabled: true, defaultValue: 'Reviews pull requests.' } };
export const Touch: Story = { args: { size: 'touch' } };
