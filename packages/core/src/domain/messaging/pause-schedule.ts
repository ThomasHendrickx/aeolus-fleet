import type { IdGenerator, ScheduleId } from '@aeolus-fleet/common';

import { keepingReachRefusal, type CheckManageTx, type NotReachable } from '../registry/public.js';
import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { ScheduleRepository } from './ports.js';
import { pauseSchedule, type PauseRefusal } from './schedule.js';
import { scheduleAccess } from './schedule-access.js';

export interface PauseScheduleTx extends CheckManageTx {
  schedules: Pick<ScheduleRepository, 'findForUpdate' | 'save'>;
  events: EventLog;
}

export type PauseScheduleRefusal = DomainError<'SCHEDULE_NOT_FOUND'> | PauseRefusal | NotReachable;

export type PauseSchedule = (caller: Caller, input: { scheduleId: ScheduleId }) => Promise<Result<{ scheduleId: ScheduleId; state: 'paused' }, PauseScheduleRefusal>>;

/**
 * Use case: pauses a schedule (`pauseSchedule`, decision 0062, S10): it
 * sends nothing until its ship resumes it, with SchedulePaused on its ship,
 * caused by the caller. Its ship pauses its own, the reason ship; an actor
 * with fleet:manage within manage reach of that ship pauses any, the reason
 * manager. Anyone else is told there is no such schedule. A paused schedule
 * is answered paused again, unchanged; an ended or cancelled one is refused.
 */
export function createPauseSchedule(deps: { uow: UnitOfWork<PauseScheduleTx>; clock: Clock; ids: IdGenerator }): PauseSchedule {
  return (caller, { scheduleId }) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<{ scheduleId: ScheduleId; state: 'paused' }, PauseScheduleRefusal>> => {
      const notFound = refuse('SCHEDULE_NOT_FOUND', `Schedule ${scheduleId} does not exist`);
      const schedule = await tx.schedules.findForUpdate(caller.fleetId, scheduleId);
      if (!schedule) {
        return notFound;
      }
      const at = deps.clock.now();
      const access = await scheduleAccess({ tx, ids: deps.ids }, { caller, shipId: schedule.shipId, at });
      if (!access.isOk) {
        return access;
      }
      if (access.value === 'none') {
        return notFound;
      }
      const paused = pauseSchedule(schedule, { reason: access.value, actor: actorOf(caller), at });
      if (!paused.isOk) {
        return paused;
      }
      if (paused.value.events.length > 0) {
        await tx.schedules.save(paused.value.schedule);
      }
      for (const event of paused.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ scheduleId, state: 'paused' as const });
    });
}
