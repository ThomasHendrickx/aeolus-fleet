import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

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

/** The report's state as ShipState draws it (docs/design/state-colours): its word and icon in the tone that means it. */
async function expectState(canvasElement: HTMLElement, { word, tone }: { word: string; tone: string }) {
  const state = within(within(canvasElement).getByTestId('ship-report')).getByTestId('ship-state');
  await expect(state).toHaveTextContent(word);
  await expect(state.querySelector('svg')).not.toBeNull();
  await expect(state).toHaveAttribute('data-tone', tone);
}

/** Working in Sea, the active tone. */
export const WorkingRow: Story = {
  play: async ({ canvasElement }) => expectState(canvasElement, { word: 'Working', tone: 'active' }),
  args: { report: { state: 'working', note: 'Reviewing PR #322 (api)', task: null, step: null, reportedAt: '2026-10-03T07:08:00.000Z', reportChangedAt: '2026-10-03T07:08:00.000Z', detailsVersion: 0 } },
};
/** Blocked in violet: the crew says it cannot go on. */
export const BlockedRow: Story = {
  play: async ({ canvasElement }) => expectState(canvasElement, { word: 'Blocked', tone: 'blocked' }),
  args: { report: { state: 'blocked', note: 'checkout-e2e flaky, needs a decision on retries', task: null, step: null, reportedAt: '2026-10-03T07:09:26.000Z', reportChangedAt: '2026-10-03T07:09:26.000Z', detailsVersion: 0 } },
};
/** Idle carries no tone: the muted foreground. */
export const IdleRow: Story = {
  play: async ({ canvasElement }) => expectState(canvasElement, { word: 'Idle', tone: 'none' }),
  args: { report: { state: 'idle', note: 'Queue empty', task: null, step: null, reportedAt: '2026-10-03T07:09:42.000Z', reportChangedAt: '2026-10-03T07:09:42.000Z', detailsVersion: 0 } },
};
export const NoReportYet: Story = {};
export const ShipPage: Story = {
  args: { variant: 'full', report: { state: 'working', note: 'Reviewing PR #322 (api)', task: null, step: null, reportedAt: '2026-10-03T07:08:00.000Z', reportChangedAt: '2026-10-03T07:08:00.000Z', detailsVersion: 0 } },
};
export const ShipPageBlocked: Story = {
  play: async ({ canvasElement }) => expectState(canvasElement, { word: 'Blocked', tone: 'blocked' }),
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
