import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { PR_READY } from '../../../../lib/fixtures/inbox.fixtures';
import { MessageMenu } from './message-menu';

const meta = {
  title: 'Molecules/MessageMenu',
  component: MessageMenu,
  args: { messageId: PR_READY.messageId, shipId: PR_READY.sender.id, shipName: PR_READY.sender.name, onMarkUnread: fn(), size: 'sm' },
} satisfies Meta<typeof MessageMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

/** Mark as unread, Copy message id and Open the ship. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('inbox-message-menu'));
    await expect(await within(document.body).findByTestId('inbox-open-ship')).toHaveTextContent('Open orchestrator-2');
  },
};

/** A message already done, or a viewer: no Mark as unread. */
export const WithoutMarkUnread: Story = { args: { onMarkUnread: undefined } };
