import type { MessageId, ScheduleItem, ScheduleState, ScheduleTimingItem } from '@aeolus-fleet/common';
import { durationMs } from '@aeolus-fleet/common/rules';

import { duration, relativeTime, shortDateTime } from '../../../lib/relative-time';
import { labelSelectionWords, recipientGroupWords } from '../../../lib/recipient';
import { counted } from '../../../lib/sentence';

const MINUTE_MS = 60_000;

/** A ship's schedule as its row on the ship page shows it (decision 0062). */
export interface ScheduleRow {
  scheduleId: ScheduleItem['scheduleId'];
  state: ScheduleState;
  /** "To chief-of-staff", "To any ship of type reviewer". */
  recipient: string;
  /** "Once, 26 Oct, 09:00", "Every 6 h", "Cron 0 9 * * 1-5, Europe/Brussels", with a repeat's end and count. */
  timing: string;
  /** "Next 25 Oct, 18:00"; none once it ended or was cancelled. */
  nextSend: string | undefined;
  /** What its last send time gave; a sent one opens its message. None before its first. */
  lastOutcome: { text: string; messageId?: MessageId } | undefined;
  /** Only an active schedule pauses; only its own ship resumes one (S10). */
  canPause: boolean;
  /** An ended or cancelled schedule never sends again: nothing to cancel. */
  canCancel: boolean;
}

function recipientOf(selector: ScheduleItem['selector']): string {
  if (selector.kind === 'type') {
    return `To ${recipientGroupWords(selector)}`;
  }
  if (selector.kind === 'label') {
    return `To every ship carrying ${labelSelectionWords(selector.values ?? selector.valueIds.map((valueId) => ({ valueId, key: null, value: null })))}`;
  }
  return 'name' in selector ? `To ${selector.name}` : `To ${selector.shipId}`;
}

/** "6 h", "1 d"; a length under a minute as written, since the console words nothing shorter. */
function everyWords(every: string): string {
  const ms = durationMs(every);
  return ms === undefined || ms < MINUTE_MS ? every : duration(new Date(0), new Date(ms));
}

function timingOf(timing: ScheduleTimingItem): string {
  if (timing.kind === 'once') {
    return `Once, ${shortDateTime(new Date(timing.at))}`;
  }
  const repeat = timing.kind === 'every' ? `Every ${everyWords(timing.every)}` : `Cron ${timing.cron}, ${timing.timeZone}`;
  const end = timing.end === null ? [] : [`until ${shortDateTime(new Date(timing.end))}`];
  const count = timing.count === null ? [] : [`at most ${counted(timing.count, { one: 'send', many: 'sends' })}`];
  return [repeat, ...end, ...count].join(', ');
}

function lastOutcomeOf(outcome: ScheduleItem['lastOutcome'], now: Date): ScheduleRow['lastOutcome'] {
  if (outcome === null) {
    return undefined;
  }
  const when = relativeTime(new Date(outcome.at), now);
  switch (outcome.kind) {
    case 'sent':
      return { text: `Sent ${when}`, messageId: outcome.messageId };
    case 'refused':
      return { text: `Refused ${when}: ${outcome.code}` };
    case 'missed':
      return { text: `Missed the send time ${shortDateTime(new Date(outcome.sendTime))}` };
  }
}

export function scheduleRowOf(schedule: ScheduleItem, now: Date): ScheduleRow {
  return {
    scheduleId: schedule.scheduleId,
    state: schedule.state,
    recipient: recipientOf(schedule.selector),
    timing: timingOf(schedule.timing),
    nextSend: schedule.nextSendTime === null ? undefined : `Next ${shortDateTime(new Date(schedule.nextSendTime))}`,
    lastOutcome: lastOutcomeOf(schedule.lastOutcome, now),
    canPause: schedule.state === 'active',
    canCancel: schedule.state === 'active' || schedule.state === 'paused',
  };
}
