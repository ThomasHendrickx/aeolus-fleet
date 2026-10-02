import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ReportStatus } from './report-status';

const NOW = new Date('2026-10-02T19:10:00.000Z');

const meta = {
  title: 'Molecules/ReportStatus',
  component: ReportStatus,
  args: { now: NOW, testId: 'ship-report', report: null },
} satisfies Meta<typeof ReportStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Working: Story = {
  args: { report: { state: 'working', note: 'on PR 89', reportedAt: '2026-10-02T19:08:00.000Z' } },
};
export const Blocked: Story = {
  args: { report: { state: 'blocked', note: 'waiting for review on PR 88', reportedAt: '2026-10-02T18:55:00.000Z' } },
};
export const IdleWithoutNote: Story = {
  args: { report: { state: 'idle', note: null, reportedAt: '2026-10-02T19:10:00.000Z' } },
};
export const NeverReported: Story = {};
