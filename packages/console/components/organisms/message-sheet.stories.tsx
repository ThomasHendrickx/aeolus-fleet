import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { MessageSheet } from './message-sheet';
import { DIRECT_MESSAGE, TYPE_MESSAGE, UNDELIVERABLE_HISTORY, UNKNOWN_MESSAGE_ID } from './ship-page.fixtures';

const meta = {
  title: 'Organisms/MessageSheet',
  component: MessageSheet,
  args: { message: TYPE_MESSAGE, state: 'ready', isOpen: true, onOpenChange: fn() },
} satisfies Meta<typeof MessageSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TypeAddressed: Story = {};
export const Direct: Story = { args: { message: DIRECT_MESSAGE } };
/** Reply answers the sender as argo, through Compose. */
export const WithReply: Story = { args: { message: DIRECT_MESSAGE, onReply: fn() } };
export const Undeliverable: Story = {
  args: {
    message: {
      ...DIRECT_MESSAGE,
      delivery: { ...DIRECT_MESSAGE.delivery, state: 'undeliverable', attempts: 5, history: UNDELIVERABLE_HISTORY },
    },
  },
};
export const Loading: Story = { args: { message: undefined, state: 'loading' } };
export const NotFound: Story = { args: { message: undefined, messageId: UNKNOWN_MESSAGE_ID, state: 'not-found' } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
