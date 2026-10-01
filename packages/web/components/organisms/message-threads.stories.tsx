import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { MessageThreads } from './message-threads';
import { MESSAGES, NOW, REVIEWER } from './ship-page.fixtures';

const meta = {
  title: 'Organisms/MessageThreads',
  component: MessageThreads,
  args: { shipId: REVIEWER.id, messages: MESSAGES, state: 'ready', now: NOW, onOpenMessage: fn(), onRetry: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-180">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MessageThreads>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Threads: Story = {};
export const Empty: Story = { args: { messages: [] } };
export const Loading: Story = { args: { state: 'loading' } };
export const Error: Story = { args: { state: 'error' } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
