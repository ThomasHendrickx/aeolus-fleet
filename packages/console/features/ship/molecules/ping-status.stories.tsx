import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { PingStatus } from './ping-status';

const NOW = new Date('2026-10-02T09:10:00.000Z');

const meta = {
  title: 'Molecules/PingStatus',
  component: PingStatus,
  args: { now: NOW, testId: 'ship-ping-status', ping: null },
} satisfies Meta<typeof PingStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Waiting: Story = {
  args: { ping: { state: 'waiting', sentAt: '2026-10-02T09:07:00.000Z', answeredAt: null } },
};
export const Answered: Story = {
  args: { ping: { state: 'answered', sentAt: '2026-10-02T09:07:00.000Z', answeredAt: '2026-10-02T09:07:04.000Z' } },
};
export const Received: Story = {
  args: { ping: { state: 'received', sentAt: '2026-10-02T09:07:00.000Z', answeredAt: null } },
};
/** Handed out again and again and never acknowledged: it went undeliverable. */
export const Undeliverable: Story = {
  args: { ping: { state: 'undeliverable', sentAt: '2026-10-02T07:40:00.000Z', answeredAt: null } },
};
export const NeverPinged: Story = {};
