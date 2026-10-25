import type { FleetId, IdGenerator, ScheduleId } from '@aeolus-fleet/common';

import { findShip, type FleetRepository } from '../registry/public.js';
import { hasScope, type ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, SYSTEM, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { RequestHasher, ScheduleAttempts, ScheduleNotifier, ScheduleRepository } from './ports.js';
import { cancelSchedule, scheduledMessageKey, scheduleRefused, scheduleSent, type Schedule } from './schedule.js';
import { sendWithin, type CheckedSend, type SendMessageTx } from './send-message.js';
import { sendRequestText } from './send-request.js';

export interface SendDueSchedulesTx extends SendMessageTx {
  schedules: Pick<ScheduleRepository, 'claimDue' | 'save'>;
  scheduleNotifier: ScheduleNotifier;
}

/** Hears a failed schedule send, for the server's log: the pass goes on with the next. */
export type ScheduleSendFailed = (fleetId: FleetId, error: unknown) => void;

export type SendDueSchedules = (onError?: ScheduleSendFailed) => Promise<{ nextAttemptAt: Date | undefined }>;

/**
 * Use case: sends every schedule that is due (decision 0062), run by core on
 * a server's timer and on the 30 second pass, never through the API. Each
 * one is its own unit of work: claim one due schedule, skipping those another
 * server holds; send its message as its ship, checked as a send by that ship
 * now (its scopes, reach, the daily limit, the selector), its payload as
 * stored, its schedule and send time on the envelope, its key derived from
 * both; record the outcome on the schedule, by its refusal strategy when
 * refused; advance it; commit. A unit of work that fails stores nothing and
 * advances nothing, so the next pass sends that send time; a committed one
 * advanced it, so nothing is sent again, and the derived key would find the
 * stored message even under a second claim. A pass tries each schedule
 * once. Answers when the earliest attempt still ahead is due, for the timer.
 */
export function createSendDueSchedules(deps: {
  fleets: Pick<FleetRepository, 'list'>;
  scheduleAttempts: ScheduleAttempts;
  uow: UnitOfWork<SendDueSchedulesTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: RequestHasher;
}): SendDueSchedules {
  return async (onError) => {
    let nextAttemptAt: Date | undefined;
    for (const fleet of await deps.fleets.list()) {
      const tried: ScheduleId[] = [];
      for (;;) {
        const claimed: { scheduleId?: ScheduleId } = {};
        try {
          const sent = await deps.uow.run(async (tx): Promise<Result<ScheduleId | undefined, never>> => {
            const schedule = await tx.schedules.claimDue(fleet.id, tried);
            if (!schedule) {
              return ok(undefined);
            }
            claimed.scheduleId = schedule.id;
            await sendScheduleWithin({ tx, clock: deps.clock, ids: deps.ids, hasher: deps.hasher }, schedule);
            return ok(schedule.id);
          });
          if (!sent.isOk || sent.value === undefined) {
            break;
          }
          tried.push(sent.value);
        } catch (error) {
          onError?.(fleet.id, error);
          if (claimed.scheduleId === undefined) {
            break;
          }
          tried.push(claimed.scheduleId);
        }
      }
      const fleetAttempt = await deps.scheduleAttempts.nextAttemptAt(fleet.id);
      if (fleetAttempt && (!nextAttemptAt || fleetAttempt < nextAttemptAt)) {
        nextAttemptAt = fleetAttempt;
      }
    }
    return { nextAttemptAt };
  };
}

/**
 * One claimed schedule's send time, inside its unit of work. Its ship as it
 * is now is the sender: a retired one sends nothing and its schedule is
 * cancelled, as its retire would have done (S11).
 */
async function sendScheduleWithin(deps: { tx: SendDueSchedulesTx; clock: Clock; ids: IdGenerator; hasher: RequestHasher }, schedule: Schedule): Promise<void> {
  const { tx, clock, ids } = deps;
  const at = clock.now();
  const sendTime = schedule.nextSendTime;
  const ship = await findShip(tx, { fleetId: schedule.fleetId, shipId: schedule.shipId });
  if (!ship.isOk || ship.value.retiredAt !== null || sendTime === null) {
    const cancelled = cancelSchedule(schedule, { reason: 'retired', actor: SYSTEM, at });
    if (cancelled.isOk) {
      await stored(deps, cancelled.value);
    }
    return;
  }
  const caller: ShipCaller = { shipId: ship.value.id, fleetId: ship.value.fleetId, kind: ship.value.kind, scopes: ship.value.scopes };
  const { send } = schedule;
  const missingScope = !hasScope(caller, 'messages:send') ? 'messages:send' : send.isForced && !hasScope(caller, 'messages:force') ? 'messages:force' : undefined;
  if (missingScope !== undefined) {
    await stored(deps, scheduleRefused(schedule, { code: 'FORBIDDEN', sendTime, at }));
    return;
  }
  const inReplyTo = send.inReplyTo ?? undefined;
  const request: CheckedSend = {
    selector: send.selector,
    payload: send.payload,
    contentType: send.contentType,
    model: send.model ?? undefined,
    idempotencyKey: scheduledMessageKey(schedule.id, sendTime),
    inReplyTo,
    isForced: send.isForced,
    requestHash: deps.hasher.hash(sendRequestText({ selector: send.selector, payload: send.payload, contentType: send.contentType, inReplyTo, isForced: send.isForced })),
    scheduledFor: { scheduleId: schedule.id, sendTime },
  };
  const sent = await sendWithin({ tx, clock, ids }, { caller, request });
  await stored(deps, sent.isOk ? scheduleSent(schedule, { messageId: sent.value.messageId, sendTime, at }) : scheduleRefused(schedule, { code: sent.error.kind, sendTime, at }));
}

/** Stores the schedule as it changed and its events, and tells the timers of a next attempt. */
async function stored(deps: { tx: SendDueSchedulesTx; ids: IdGenerator }, changed: { schedule: Schedule; events: NewEvent[] }): Promise<void> {
  const { tx, ids } = deps;
  const { schedule, events } = changed;
  await tx.schedules.save(schedule);
  for (const event of events) {
    await recordEvent({ events: tx.events, ids }, event);
  }
  if (schedule.state === 'active' && schedule.nextAttemptAt !== null) {
    await tx.scheduleNotifier.scheduleDue({ fleetId: schedule.fleetId, scheduleId: schedule.id, attemptAt: schedule.nextAttemptAt });
  }
}
