import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { LastSeen } from './last-seen';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const meta = {
  title: 'Molecules/LastSeen',
  component: LastSeen,
  args: { seenAt: ago(25_000), now: NOW },
} satisfies Meta<typeof LastSeen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Fresh: Story = {};
export const AWhile: Story = { args: { seenAt: ago(8 * 60_000) } };
export const LongAgo: Story = { args: { seenAt: ago(2 * 60 * 60_000) } };
