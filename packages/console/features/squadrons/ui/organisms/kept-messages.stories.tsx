import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { KeptMessages } from './kept-messages';

const NOW = new Date('2026-10-03T12:00:00.000Z');

const meta = {
  title: 'Organisms/KeptMessages',
  component: KeptMessages,
  args: {
    flagshipId: 'shp_01m3tbfspe96yf1rnr4ank0000',
    now: NOW,
    state: 'ready',
    onRetry: () => undefined,
    messages: [
      {
        deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
        messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
        senderShipId: 'shp_01m3tbfspe96yf1rnr4ank0009',
        senderName: 'reviewer-01',
        contentType: 'text/plain',
        payload: 'Build login for issue #42\nDetails in the issue.',
        inReplyTo: null,
        receivedAt: '2026-10-03T11:48:00.000Z',
      },
    ],
  },
} satisfies Meta<typeof KeptMessages>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneKept: Story = {};
export const NoneKept: Story = { args: { messages: [] } };
export const Loading: Story = { args: { state: 'loading' } };
export const LoadFailed: Story = { args: { state: 'error', error: 'squadrons did not answer: try again in a moment' } };
