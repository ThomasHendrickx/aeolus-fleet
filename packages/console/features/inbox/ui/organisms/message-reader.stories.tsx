import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { DISCARDED, KEY_NOT_REACHABLE_PR_READY, PR_READY, SEALED_PR_READY, SLICE_DONE, THREAD } from '../../../../lib/fixtures/inbox.fixtures';
import { MessageReader } from './message-reader';

const meta = {
  title: 'Organisms/MessageReader',
  component: MessageReader,
  args: { message: PR_READY, thread: THREAD, isPhone: false, onReply: fn(), onMarkDone: fn(), onMarkUnread: fn(), isPending: false },
  decorators: [(Story) => <div className="flex h-160 flex-col">{Story()}</div>],
} satisfies Meta<typeof MessageReader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The headline as title, the body rendered, the pull request row and the thread; Done in the bar. */
export const Open: Story = {};

/** Writing a reply turns Done into Send reply. */
export const Replying: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId('inbox-reply'), 'Merged.');
    await expect(canvas.getByTestId('inbox-reply-send')).toHaveTextContent('Send reply');
  },
};

export const DoneMessage: Story = { args: { message: SLICE_DONE, thread: [] } };

/** A plugin ship's message: the plugin mark and its type, folded when long. */
export const FromPlugin: Story = { args: { message: DISCARDED, thread: [] } };

export const Pending: Story = { args: { isPending: true } };

export const ReadOnly: Story = { args: { isReadOnly: true } };

/** A sealed payload: rendered as today, Sealed in the line under the title (decision 0068, N1). */
export const Sealed: Story = {
  args: { message: SEALED_PR_READY },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('inbox-message-sealed')).toHaveTextContent('Sealed');
  },
};
/** The company key cut off: the title names the sender, a panel stands in for the body, Done still works (scenario 25). */
export const KeyNotReachable: Story = {
  args: { message: KEY_NOT_REACHABLE_PR_READY, thread: [] },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Message from orchestrator-2' })).toBeVisible();
    await expect(canvas.getByTestId('inbox-message-not-reachable')).toHaveTextContent('Sealed, key not reachable');
    await userEvent.click(canvas.getByTestId('inbox-mark-done'));
    await expect(args.onMarkDone).toHaveBeenCalled();
  },
};
/** A reply refused while the key is cut off: nothing sent, the draft kept. */
export const ReplyRefused: Story = {
  args: { message: KEY_NOT_REACHABLE_PR_READY, thread: [], replyRefusal: { title: 'Couldn’t send your reply', description: 'Your company key is not reachable. Nothing was sent; your reply is kept.' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('Couldn’t send your reply');
  },
};
export const PhoneKeyNotReachable: Story = { args: { message: KEY_NOT_REACHABLE_PR_READY, thread: [], isPhone: true }, globals: { viewport: { value: 'mobile1' } } };
