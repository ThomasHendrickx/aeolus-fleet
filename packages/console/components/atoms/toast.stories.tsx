import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { RefreshCw } from 'lucide-react';

import { Button } from './button';
import { showToast, ToastCard, Toaster } from './toast';

const meta = {
  title: 'Atoms/Toast',
  component: ToastCard,
  decorators: [
    (Story) => (
      <div className="max-w-(--size-toast)">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ToastCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => undefined;

export const SuccessWithAction: Story = {
  args: {
    title: 'auditor-01 commissioned',
    description: 'It shows as Awaiting crew until a session claims it.',
    action: { label: 'View', onClick: noop },
  },
};
export const Info: Story = {
  args: { tone: 'info', title: 'Marked as unread', description: 'It stays open in your inbox.' },
};
export const ErrorWithRetry: Story = {
  args: {
    tone: 'error',
    title: 'Couldn’t resend',
    description: 'The server did not answer. Nothing was sent.',
    action: { label: 'Try again', icon: <RefreshCw />, onClick: noop },
    onDismiss: noop,
  },
};

/** The real Toaster, bottom right on desktop and above the TabBar on phone. */
export const Shown: Story = {
  args: { title: 'reviewer-01 released' },
  render: () => (
    <>
      <Button
        onClick={() => {
          showToast({ title: 'reviewer-01 released', description: 'Its old secret no longer works.' });
        }}
      >
        Show toast
      </Button>
      <Toaster />
    </>
  ),
};
