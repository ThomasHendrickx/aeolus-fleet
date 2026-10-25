import type { ScheduleItem, ScheduleTiming } from '@aeolus-fleet/common';

import type { Schedule, ScheduleOutcome } from '../../domain/messaging/schedule.js';
import type { Page } from '../../domain/shared/page.js';

/**
 * A schedule as `ship.schedules` and `fleet.schedules` answer it (decision
 * 0062): its send input but the payload, its timing and strategy, its state,
 * next send time and last outcome, times in ISO 8601.
 */
function scheduleItemOf(schedule: Schedule): ScheduleItem {
  const timing: ScheduleTiming = { kind: schedule.timing.kind, at: schedule.timing.at.toISOString() };
  return {
    scheduleId: schedule.id,
    shipId: schedule.shipId,
    state: schedule.state,
    selector: schedule.send.selector,
    contentType: schedule.send.contentType,
    inReplyTo: schedule.send.inReplyTo,
    isForced: schedule.send.isForced,
    timing,
    onRefused: schedule.onRefused,
    retryWindow: schedule.retryWindow,
    nextSendTime: schedule.nextSendTime?.toISOString() ?? null,
    lastOutcome: schedule.lastOutcome && outcomeOf(schedule.lastOutcome),
    createdAt: schedule.createdAt.toISOString(),
    endedAt: schedule.endedAt?.toISOString() ?? null,
    cancelledAt: schedule.cancelledAt?.toISOString() ?? null,
  };
}

function outcomeOf(outcome: ScheduleOutcome): ScheduleItem['lastOutcome'] {
  const times = { sendTime: outcome.sendTime.toISOString(), at: outcome.at.toISOString() };
  return outcome.kind === 'sent' ? { kind: 'sent', messageId: outcome.messageId, ...times } : { kind: 'refused', code: outcome.code, ...times };
}

export function schedulesPageOf(page: Page<Schedule, Schedule['id']>) {
  return { items: page.items.map(scheduleItemOf), nextCursor: page.nextCursor };
}
