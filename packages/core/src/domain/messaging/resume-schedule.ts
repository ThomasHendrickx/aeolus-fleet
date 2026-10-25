import type { IdGenerator, ScheduleId } from '@aeolus-fleet/common';

import { actorOf, isShipCaller, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { ScheduleNotifier, ScheduleRepository } from './ports.js';
import { resumeSchedule, type PauseRefusal } from './schedule.js';

export interface ResumeScheduleTx {
  schedules: Pick<ScheduleRepository, 'findForUpdate' | 'save'>;
  scheduleNotifier: ScheduleNotifier;
  events: EventLog;
}

export type ResumeScheduleRefusal = DomainError<'SCHEDULE_NOT_FOUND'> | PauseRefusal;

export type ResumeSchedule = (caller: Caller, input: { scheduleId: ScheduleId }) => Promise<Result<{ scheduleId: ScheduleId; state: 'active' | 'ended' }, ResumeScheduleRefusal>>;

/**
 * Use case: resumes a paused schedule (`resumeSchedule`, decision 0062,
 * S10): only its ship resumes it, anyone else is told there is no such
 * schedule. The send times passed while paused are skipped: it goes on at its
 * first send time after now, with ScheduleResumed, telling the servers'
 * timers, or ends when it has none. An active schedule is answered active
 * again, unchanged; an ended or cancelled one is refused.
 */
export function createResumeSchedule(deps: { uow: UnitOfWork<ResumeScheduleTx>; clock: Clock; ids: IdGenerator }): ResumeSchedule {
  return (caller, { scheduleId }) =>
    deps.uow.run(async (tx): Promise<Result<{ scheduleId: ScheduleId; state: 'active' | 'ended' }, ResumeScheduleRefusal>> => {
      const schedule = await tx.schedules.findForUpdate(caller.fleetId, scheduleId);
      if (!schedule || !isShipCaller(caller) || caller.shipId !== schedule.shipId) {
        return refuse('SCHEDULE_NOT_FOUND', `Schedule ${scheduleId} does not exist`);
      }
      const resumed = resumeSchedule(schedule, { actor: actorOf(caller), at: deps.clock.now() });
      if (!resumed.isOk) {
        return resumed;
      }
      const { schedule: changed, events } = resumed.value;
      if (events.length > 0) {
        await tx.schedules.save(changed);
      }
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      if (events.length > 0 && changed.state === 'active' && changed.nextAttemptAt !== null) {
        await tx.scheduleNotifier.scheduleDue({ fleetId: changed.fleetId, scheduleId, attemptAt: changed.nextAttemptAt });
      }
      return ok({ scheduleId, state: changed.state === 'ended' ? ('ended' as const) : ('active' as const) });
    });
}
