import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ReportLine } from './report-line';
import { REPORT_TASKS, VIEWER_FLEET_ID } from '../../lib/fixtures/report.fixtures';

const NOW = new Date('2026-10-03T07:10:00.000Z');

const meta = {
  title: 'Molecules/ReportLine',
  component: ReportLine,
  args: { now: NOW, testId: 'ship-report', variant: 'row', report: null, viewerFleetId: VIEWER_FLEET_ID },
} satisfies Meta<typeof ReportLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkingRow: Story = {
  args: { report: { state: 'working', note: 'Reviewing PR #322 (api)', task: null, step: null, reportedAt: '2026-10-03T07:08:00.000Z', reportChangedAt: '2026-10-03T07:08:00.000Z', detailsVersion: 0 } },
};
export const BlockedRow: Story = {
  args: { report: { state: 'blocked', note: 'checkout-e2e flaky, needs a decision on retries', task: null, step: null, reportedAt: '2026-10-03T07:09:26.000Z', reportChangedAt: '2026-10-03T07:09:26.000Z', detailsVersion: 0 } },
};
export const IdleRow: Story = {
  args: { report: { state: 'idle', note: 'Queue empty', task: null, step: null, reportedAt: '2026-10-03T07:09:42.000Z', reportChangedAt: '2026-10-03T07:09:42.000Z', detailsVersion: 0 } },
};
export const NoReportYet: Story = {};
export const ShipPage: Story = {
  args: { variant: 'full', report: { state: 'working', note: 'Reviewing PR #322 (api)', task: null, step: null, reportedAt: '2026-10-03T07:08:00.000Z', reportChangedAt: '2026-10-03T07:08:00.000Z', detailsVersion: 0 } },
};
export const ShipPageBlocked: Story = {
  args: { variant: 'full', report: { state: 'blocked', note: 'Waiting for go on 2.15', task: null, step: null, reportedAt: '2026-10-03T07:08:00.000Z', reportChangedAt: '2026-10-03T07:08:00.000Z', detailsVersion: 0 } },
};
export const ShipPageNone: Story = { args: { variant: 'full' } };

/** The monitoring design's report: a task and a step, changed 4 min ago, reported 1 min ago. */
const MERGING = {
  state: 'working',
  note: 'Merging to main',
  task: REPORT_TASKS.pullRequest,
  step: { at: 2, of: 3 },
  reportedAt: '2026-10-03T07:09:00.000Z',
  reportChangedAt: '2026-10-03T07:06:00.000Z',
  detailsVersion: 0,
} as const;

export const TaskAndStepRow: Story = { args: { report: MERGING } };
export const TaskAndStepOverview: Story = { args: { report: MERGING, isTimeInTitle: true } };
export const TaskAndStepShipPage: Story = { args: { variant: 'full', report: MERGING } };
export const IssueTaskRow: Story = { args: { report: { ...MERGING, task: REPORT_TASKS.issue, step: null } } };
export const OtherUrlTaskRow: Story = { args: { report: { ...MERGING, task: REPORT_TASKS.otherUrl, step: null } } };
export const MessageTaskRow: Story = { args: { report: { ...MERGING, note: 'Drafting the guide', task: REPORT_TASKS.message, step: { at: 1, of: 4 } } } };
export const MessageInAnotherFleetShipPage: Story = { args: { variant: 'full', report: { ...MERGING, task: REPORT_TASKS.messageInAnotherFleet } } };
export const UnknownTaskShipPage: Story = { args: { variant: 'full', report: { ...MERGING, task: REPORT_TASKS.unknown, step: null } } };
export const StepWithoutTaskShipPage: Story = { args: { variant: 'full', report: { ...MERGING, task: null } } };

/** Monitoring W2: a message link comes only from the server's permission decision. */
export const OpenMessageTask: Story = { args: { report: { ...MERGING, task: REPORT_TASKS.message, taskView: { canOpen: true, fleetName: null } } } };
export const MessageOutsideReadReach: Story = { args: { report: { ...MERGING, task: REPORT_TASKS.message, taskView: { canOpen: false, fleetName: null } } } };
export const OpenOtherFleetMessage: Story = { args: { variant: 'full', report: { ...MERGING, task: REPORT_TASKS.messageInAnotherFleet, taskView: { fleetName: 'Other fleet', canOpen: true } } } };
export const OtherFleetMessageOutsideReadReach: Story = { args: { report: { ...MERGING, task: REPORT_TASKS.messageInAnotherFleet, taskView: { fleetName: 'Other fleet', canOpen: false } } } };
