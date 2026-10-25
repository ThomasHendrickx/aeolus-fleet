import { idSchema, type ScheduleItem } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { LoadMore } from '../../../../components/molecules/load-more';
import { minutesAgo, NOW, REVIEWER } from '../../../../lib/fixtures/ship-page.fixtures';
import { ShipSchedules } from './ship-schedules';

const scheduleId = (suffix: string) => idSchema('schedule').parse(`sch_01j8zd2vqzr3a9w6m2v5n7${suffix}`);
const MINUTE_MS = 60_000;
const minutesFromNow = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE_MS).toISOString();

const CHECK_IN: ScheduleItem = {
  scheduleId: scheduleId('c4k1'),
  shipId: REVIEWER.id,
  state: 'active',
  selector: { kind: 'ship', name: 'chief-of-staff' },
  contentType: 'text/plain',
  inReplyTo: null,
  isForced: false,
  timing: { kind: 'every', every: 'PT6H', start: null, end: null, count: null },
  onRefused: 'skip',
  retryWindow: 'PT1H',
  onMissed: 'each',
  grace: 'PT5M',
  nextSendTime: minutesFromNow(150),
  lastOutcome: { kind: 'sent', messageId: idSchema('message').parse('msg_01j8zd2vqzr3a9w6m2v5n7s3n1'), sendTime: minutesAgo(210), at: minutesAgo(210) },
  createdAt: minutesAgo(3000),
  endedAt: null,
  cancelledAt: null,
};
const REMINDER: ScheduleItem = {
  ...CHECK_IN,
  scheduleId: scheduleId('r3m2'),
  selector: { kind: 'ship', name: REVIEWER.name },
  timing: { kind: 'once', at: minutesFromNow(1110) },
  nextSendTime: minutesFromNow(1110),
  lastOutcome: null,
};
const PAUSED: ScheduleItem = {
  ...CHECK_IN,
  scheduleId: scheduleId('p4s3'),
  state: 'paused',
  selector: { kind: 'type', type: 'builder' },
  timing: { kind: 'cron', cron: '0 9 * * 1-5', timeZone: 'Europe/Brussels', start: null, end: null, count: null },
  onRefused: 'pause',
  lastOutcome: { kind: 'refused', code: 'NOT_REACHABLE', sendTime: minutesAgo(330), at: minutesAgo(330) },
};
const ENDED: ScheduleItem = {
  ...CHECK_IN,
  scheduleId: scheduleId('e5d4'),
  state: 'ended',
  timing: { kind: 'every', every: 'P1D', start: null, end: null, count: 3 },
  nextSendTime: null,
  endedAt: minutesAgo(900),
};
const CANCELLED: ScheduleItem = { ...CHECK_IN, scheduleId: scheduleId('c5n6'), state: 'cancelled', nextSendTime: null, lastOutcome: { kind: 'missed', sendTime: minutesAgo(1500), at: minutesAgo(1490) }, cancelledAt: minutesAgo(1400) };

const meta = {
  title: 'Organisms/ShipSchedules',
  component: ShipSchedules,
  args: { schedules: [REMINDER, CHECK_IN, PAUSED, ENDED, CANCELLED], state: 'ready', now: NOW, onPause: fn(), onCancel: fn(), onOpenMessage: fn(), onRetry: fn() },
} satisfies Meta<typeof ShipSchedules>;

export default meta;
type Story = StoryObj<typeof meta>;

const rowOf = (canvasElement: HTMLElement, schedule: ScheduleItem) => {
  const row = within(canvasElement).getAllByTestId('ship-schedule').find((each) => each.dataset.scheduleId === schedule.scheduleId);
  if (row === undefined) {
    throw new Error(`No row for ${schedule.scheduleId}`);
  }
  return within(row);
};

/** Each state: an active one offers Pause and Cancel, a paused one Cancel only (its ship resumes it), an ended or cancelled one nothing. */
export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const checkIn = rowOf(canvasElement, CHECK_IN);
    await expect(checkIn.getByText('To chief-of-staff')).toBeVisible();
    await expect(checkIn.getByText('Every 6 h')).toBeVisible();
    await userEvent.click(checkIn.getByRole('button', { name: 'Pause' }));
    await expect(args.onPause).toHaveBeenCalledWith(CHECK_IN.scheduleId);
    await userEvent.click(checkIn.getByRole('button', { name: 'Cancel' }));
    await expect(args.onCancel).toHaveBeenCalledWith(CHECK_IN.scheduleId);

    const paused = rowOf(canvasElement, PAUSED);
    await expect(paused.getByText('Paused')).toBeVisible();
    await expect(paused.getByText('Refused 5 h ago: NOT_REACHABLE')).toBeVisible();
    await expect(paused.queryByRole('button', { name: 'Pause' })).toBeNull();
    await expect(paused.getByRole('button', { name: 'Cancel' })).toBeVisible();

    for (const schedule of [ENDED, CANCELLED]) {
      await expect(rowOf(canvasElement, schedule).queryByRole('button', { name: /Pause|Cancel/ })).toBeNull();
    }
  },
};

/** A sent outcome opens the message it stored. */
export const OpensTheSentMessage: Story = {
  args: { schedules: [CHECK_IN] },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Sent 3 h ago' }));
    await expect(args.onOpenMessage).toHaveBeenCalledWith(CHECK_IN.lastOutcome?.kind === 'sent' ? CHECK_IN.lastOutcome.messageId : undefined);
  },
};

/** Pausing while the server works: the button says so, with a spinner, and takes no second press; Cancel waits. */
export const Pausing: Story = {
  args: { schedules: [CHECK_IN], pausingId: CHECK_IN.scheduleId },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Pausing…' });
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button, { pointerEventsCheck: 0 });
    await expect(args.onPause).not.toHaveBeenCalled();
    await expect(within(canvasElement).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  },
};

/** The server refused the pause: the row says why, and Pause tries again. */
export const PauseFailed: Story = {
  args: { schedules: [CHECK_IN], pauseError: { scheduleId: CHECK_IN.scheduleId, message: 'The schedule is no longer active' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('Couldn’t pause the scheduleThe schedule is no longer active. Nothing changed: try again.');
    await expect(within(canvasElement).getByRole('button', { name: 'Pause' })).toBeEnabled();
  },
};

/** Paused: the row shows its new state, with only Cancel left. */
export const Paused: Story = { args: { schedules: [{ ...CHECK_IN, state: 'paused' }] } };

export const Loading: Story = { args: { state: 'loading' } };

export const Failed: Story = {
  args: { state: 'error' },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};

export const Empty: Story = {
  args: { schedules: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/^No schedules/)).toBeVisible();
  },
};

export const WithMore: Story = {
  args: { schedules: [CHECK_IN], more: <LoadMore what="older schedules" isLoading={false} isFailed={false} onLoad={() => undefined} area="ship-schedules" /> },
};
