import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { DISCARDED, PR_READY, SLICE_DONE, THREAD } from '../../../../lib/fixtures/inbox.fixtures';
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
