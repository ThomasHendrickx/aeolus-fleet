import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Send } from 'lucide-react';

import { Button } from '../atoms/button';
import { SendShortcutHint } from './send-shortcut-hint';

const meta = {
  title: 'Molecules/SendShortcutHint',
  component: SendShortcutHint,
  decorators: [
    (Story) => (
      <Button variant="primary" icon={<Send aria-hidden />}>
        Send
        <Story />
      </Button>
    ),
  ],
} satisfies Meta<typeof SendShortcutHint>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mac: Story = { args: { platform: 'mac' } };
export const WindowsOrLinux: Story = { args: { platform: 'other' } };
