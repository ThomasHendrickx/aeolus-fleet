import type { IdGenerator, ScheduleId } from '@aeolus-fleet/common';

import { keepingReachRefusal, type CheckManageTx, type NotReachable } from '../registry/public.js';
import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { ScheduleRepository } from './ports.js';
import { cancelSchedule, type CancelRefusal } from './schedule.js';
import { scheduleAccess } from './schedule-access.js';

export interface CancelScheduleTx extends CheckManageTx {
  schedules: Pick<ScheduleRepository, 'findForUpdate' | 'save'>;
  events: EventLog;
}

export type CancelScheduleRefusal = DomainError<'SCHEDULE_NOT_FOUND'> | CancelRefusal | NotReachable;

export type CancelSchedule = (caller: Caller, input: { scheduleId: ScheduleId }) => Promise<Result<{ scheduleId: ScheduleId; state: 'cancelled' }, CancelScheduleRefusal>>;

/**
 * Use case: cancels a schedule (`cancelSchedule`, decision 0062): it sends
 * nothing more, with ScheduleCancelled on its ship, caused by the caller.
 * Its ship cancels its own, the reason ship; an actor with fleet:manage
 * within manage reach of that ship cancels any, the reason manager. Anyone
 * else is told there is no such schedule. A cancelled schedule is answered
 * cancelled again, unchanged; an ended one is refused. No edit: cancel and
 * make a new one.
 */
export function createCancelSchedule(deps: { uow: UnitOfWork<CancelScheduleTx>; clock: Clock; ids: IdGenerator }): CancelSchedule {
  return (caller, { scheduleId }) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<{ scheduleId: ScheduleId; state: 'cancelled' }, CancelScheduleRefusal>> => {
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
      const cancelled = cancelSchedule(schedule, { reason: access.value, actor: actorOf(caller), at });
      if (!cancelled.isOk) {
        return cancelled;
      }
      if (cancelled.value.events.length > 0) {
        await tx.schedules.save(cancelled.value.schedule);
      }
      for (const event of cancelled.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ scheduleId, state: 'cancelled' as const });
    });
}
