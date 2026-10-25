import type { LabelValueId, ScheduleItem, ScheduleTiming as ScheduleTimingInputText, ScheduleTimingItem } from '@aeolus-fleet/common';

import type { SchedulesPage } from '../../domain/messaging/list-schedules.js';
import type { Schedule, ScheduleOutcome, ScheduleTiming, ScheduleTimingInput } from '../../domain/messaging/schedule.js';
import type { HistoryLabelValue } from '../../domain/shared/history.js';
import type { ScheduleSelector } from '../../domain/shared/selector.js';

/**
 * A schedule as `ship.schedules` and `fleet.schedules` answer it (decision
 * 0062): its send input but the payload, its timing and strategy, its state,
 * next send time and last outcome, times in ISO 8601; a label selection with
 * each value by its texts when the page names them.
 */
function scheduleItemOf(schedule: Schedule, labelValues: ReadonlyMap<LabelValueId, HistoryLabelValue>): ScheduleItem {
  return {
    scheduleId: schedule.id,
    shipId: schedule.shipId,
    state: schedule.state,
    selector: selectorOf(schedule.send.selector, labelValues),
    contentType: schedule.send.contentType,
    inReplyTo: schedule.send.inReplyTo,
    isForced: schedule.send.isForced,
    timing: timingOf(schedule.timing),
    onRefused: schedule.onRefused,
    retryWindow: schedule.retryWindow,
    onMissed: schedule.onMissed,
    grace: schedule.grace,
    nextSendTime: schedule.nextSendTime?.toISOString() ?? null,
    lastOutcome: schedule.lastOutcome && outcomeOf(schedule.lastOutcome),
    createdAt: schedule.createdAt.toISOString(),
    endedAt: schedule.endedAt?.toISOString() ?? null,
    cancelledAt: schedule.cancelledAt?.toISOString() ?? null,
  };
}

function selectorOf(selector: ScheduleSelector, labelValues: ReadonlyMap<LabelValueId, HistoryLabelValue>): ScheduleItem['selector'] {
  if (selector.kind !== 'label') {
    return selector;
  }
  const values = selector.valueIds.flatMap((valueId) => labelValues.get(valueId) ?? []);
  return { kind: 'label', valueIds: [...selector.valueIds], ...(values.length === 0 ? {} : { values }) };
}

function timingOf(timing: ScheduleTiming): ScheduleTimingItem {
  if (timing.kind === 'once') {
    return { kind: 'once', at: timing.at.toISOString() };
  }
  const bounds = { start: timing.start?.toISOString() ?? null, end: timing.end?.toISOString() ?? null, count: timing.count };
  return timing.kind === 'every' ? { kind: 'every', every: timing.every, ...bounds } : { kind: 'cron', cron: timing.cron, timeZone: timing.timeZone, ...bounds };
}

function outcomeOf(outcome: ScheduleOutcome): ScheduleItem['lastOutcome'] {
  const times = { sendTime: outcome.sendTime.toISOString(), at: outcome.at.toISOString() };
  switch (outcome.kind) {
    case 'sent':
      return { kind: 'sent', messageId: outcome.messageId, ...times };
    case 'refused':
      return { kind: 'refused', code: outcome.code, ...times };
    case 'missed':
      return { kind: 'missed', ...times };
  }
}

export function schedulesPageOf(page: SchedulesPage) {
  const labelValues = new Map(page.labelValues.map((value) => [value.valueId, value]));
  return { items: page.items.map((schedule) => scheduleItemOf(schedule, labelValues)), nextCursor: page.nextCursor };
}

/** The timing a creator gave, its instants as dates; what it leaves out stays out, for the domain's defaults. */
export function scheduleTimingOf(timing: ScheduleTimingInputText): ScheduleTimingInput {
  if (timing.kind === 'once') {
    return { kind: 'once', at: new Date(timing.at) };
  }
  const bounds = {
    ...(timing.start === undefined ? {} : { start: new Date(timing.start) }),
    ...(timing.end === undefined ? {} : { end: new Date(timing.end) }),
    ...(timing.count === undefined ? {} : { count: timing.count }),
  };
  return timing.kind === 'every'
    ? { kind: 'every', every: timing.every, ...bounds }
    : { kind: 'cron', cron: timing.cron, ...(timing.timeZone === undefined ? {} : { timeZone: timing.timeZone }), ...bounds };
}
