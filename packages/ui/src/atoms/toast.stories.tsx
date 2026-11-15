import type { Meta, StoryObj } from '@storybook/react-vite';
import { RefreshCw } from 'lucide-react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from './button.js';
import { showToast, ToastCard, Toaster } from './toast.js';

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

/** How far from the bottom edge the Toaster sets a phone's toasts, in px. */
async function phoneBottomOffsetOf(canvasElement: HTMLElement): Promise<string> {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Show toast' }));
  await within(canvasElement).findAllByText('reviewer-01 released');
  const toaster = canvasElement.querySelector<HTMLElement>('[data-sonner-toaster]');
  if (toaster === null) {
    throw new Error('No toaster on the page');
  }
  const probe = document.createElement('div');
  probe.style.paddingBottom = 'var(--mobile-offset-bottom)';
  toaster.append(probe);
  const offset = getComputedStyle(probe).paddingBottom;
  probe.remove();
  return offset;
}

function ShowToast() {
  return (
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
  );
}

/** The real Toaster on a page without a TabBar: bottom right on desktop, 12 px from the edges on phone. */
export const Shown: Story = {
  args: { title: 'reviewer-01 released' },
  render: () => <ShowToast />,
  play: async ({ canvasElement }) => {
    await expect(await phoneBottomOffsetOf(canvasElement)).toBe('12px');
  },
};

/** On a page that shows a TabBar, the page sets --tab-bar-clearance and the phone's toasts sit above it. */
export const ShownAboveTabBar: Story = {
  args: { title: 'reviewer-01 released' },
  render: () => (
    <div className="[--tab-bar-clearance:var(--size-tabbar)]">
      <ShowToast />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(await phoneBottomOffsetOf(canvasElement)).toBe('80px');
  },
};
