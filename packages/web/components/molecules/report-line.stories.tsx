import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ReportLine } from './report-line';

const NOW = new Date('2026-10-03T07:10:00.000Z');

const meta = {
  title: 'Molecules/ReportLine',
  component: ReportLine,
  args: { now: NOW, testId: 'ship-report', variant: 'row', report: null },
} satisfies Meta<typeof ReportLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkingRow: Story = {
  args: { report: { state: 'working', note: 'Reviewing PR #322 (api)', reportedAt: '2026-10-03T07:08:00.000Z', detailsVersion: 0 } },
};
export const BlockedRow: Story = {
  args: { report: { state: 'blocked', note: 'checkout-e2e flaky, needs a decision on retries', reportedAt: '2026-10-03T07:09:26.000Z', detailsVersion: 0 } },
};
export const IdleRow: Story = {
  args: { report: { state: 'idle', note: 'Queue empty', reportedAt: '2026-10-03T07:09:42.000Z', detailsVersion: 0 } },
};
export const NoReportYet: Story = {};
export const ShipPage: Story = {
  args: { variant: 'full', report: { state: 'working', note: 'Reviewing PR #322 (api)', reportedAt: '2026-10-03T07:08:00.000Z', detailsVersion: 0 } },
};
export const ShipPageBlocked: Story = {
  args: { variant: 'full', report: { state: 'blocked', note: 'Waiting for go on 2.15', reportedAt: '2026-10-03T07:08:00.000Z', detailsVersion: 0 } },
};
export const ShipPageNone: Story = { args: { variant: 'full' } };
