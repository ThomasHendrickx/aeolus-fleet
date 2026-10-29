import type { FleetId, IdGenerator, ScheduleId } from '@aeolus-fleet/common';

import { findShip, type FleetRepository } from '../registry/public.js';
import { hasScope, type ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, SYSTEM, type NewEvent } from '../shared/events.js';
import { err, ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { RequestHasher, ScheduleAttempts, ScheduleNotifier, ScheduleRepository } from './ports.js';
import { cancelSchedule, isSendTimeToSend, scheduledMessageKey, scheduleMissed, scheduleRefused, scheduleSent, type Schedule } from './schedule.js';
import { isDataKeysNeeded, unsealed, withDataKeys, type DataKeysNeeded, type HeldDataKeys, type PayloadSealing } from './data-keys.js';
import { sendWithin, type CheckedSend, type SendMessageTx } from './send-message.js';
import { sendRequestText } from './send-request.js';

export interface SendDueSchedulesTx extends SendMessageTx {
  schedules: Pick<ScheduleRepository, 'claimDue' | 'save' | 'sentCount'>;
  scheduleNotifier: ScheduleNotifier;
}

/** Hears a failed schedule send, for the server's log: the pass goes on with the next. */
export type ScheduleSendFailed = (fleetId: FleetId, error: unknown) => void;

export type SendDueSchedules = (onError?: ScheduleSendFailed) => Promise<{ nextAttemptAt: Date | undefined }>;

/**
 * Use case: sends every schedule that is due (decision 0062), run by core on
 * a server's timer and on the 30 second pass, never through the API. Each
 * one is its own unit of work: claim one due schedule, skipping those another
 * server holds; for each of its due send times, oldest first, at most 100,
 * send its message as its ship, checked as a send by that ship now (its
 * scopes, reach, the daily limit, the selector), its payload as stored, its
 * schedule and send time on the envelope, its key derived from both, or
 * record it missed by its missed strategy; record the outcome on the
 * schedule, by its refusal strategy when refused; advance it; commit. A unit of work that fails stores nothing and
 * advances nothing, so the next pass sends that send time; a committed one
 * advanced it, so nothing is sent again, and the derived key would find the
 * stored message even under a second claim. A pass tries each schedule
 * once. Answers when the earliest attempt still ahead is due, for the timer.
 *
 * In a sealed fleet (decision 0068, B17) the schedule's payload is unsealed
 * and each message sealed for its own id, with data keys unwrapped before
 * the schedule's unit of work, never in it.
 */
export function createSendDueSchedules(deps: {
  fleets: Pick<FleetRepository, 'list'>;
  scheduleAttempts: ScheduleAttempts;
  uow: UnitOfWork<SendDueSchedulesTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: RequestHasher;
  sealing: PayloadSealing;
}): SendDueSchedules {
  return async (onError) => {
    let nextAttemptAt: Date | undefined;
    for (const fleet of await deps.fleets.list()) {
      const tried: ScheduleId[] = [];
      for (;;) {
        const claimed: { scheduleId?: ScheduleId } = {};
        try {
          const sent = await withDataKeys({ sealing: deps.sealing, fleetId: fleet.id }, (held) =>
            deps.uow.run(async (tx): Promise<Result<ScheduleId | undefined, DataKeysNeeded>> => {
              const schedule = await tx.schedules.claimDue(fleet.id, tried);
              if (!schedule) {
                return ok(undefined);
              }
              claimed.scheduleId = schedule.id;
              const handled = await sendScheduleWithin({ tx, clock: deps.clock, ids: deps.ids, hasher: deps.hasher, held }, schedule);
              return handled.isOk ? ok(schedule.id) : handled;
            }),
          );
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

/** At most this many send times of one schedule in one unit of work, oldest first; the rest on the next pass (S6). */
export const SEND_TIMES_PER_PASS = 100;

/**
 * One claimed schedule's due send times, oldest first, inside its unit of
 * work, at most SEND_TIMES_PER_PASS of them. Its ship as it is now is the
 * sender: a retired one sends nothing and its schedule is cancelled, as its
 * retire would have done (S11). A send time kept for a retry, or a pause,
 * stops the rest.
 */
async function sendScheduleWithin(deps: ScheduleSendDeps, schedule: Schedule): Promise<Result<undefined, DataKeysNeeded>> {
  const { tx, clock } = deps;
  const at = clock.now();
  const ship = await findShip(tx, { fleetId: schedule.fleetId, shipId: schedule.shipId });
  if (!ship.isOk || ship.value.retiredAt !== null || schedule.nextSendTime === null) {
    const cancelled = cancelSchedule(schedule, { reason: 'retired', actor: SYSTEM, at });
    if (cancelled.isOk) {
      await stored(deps, cancelled.value);
    }
    return ok(undefined);
  }
  const caller: ShipCaller = { shipId: ship.value.id, fleetId: ship.value.fleetId, kind: ship.value.kind, scopes: ship.value.scopes };
  let current = schedule;
  let sentCount = await tx.schedules.sentCount(schedule.fleetId, schedule.id);
  for (let handled = 0; handled < SEND_TIMES_PER_PASS; handled += 1) {
    const sendTime = current.nextSendTime;
    // The claim judged the first one due by the database's clock; the rest are due by this server's.
    if (current.state !== 'active' || sendTime === null || (handled > 0 && (current.nextAttemptAt === null || current.nextAttemptAt > at))) {
      break;
    }
    const sentOrMissed = isSendTimeToSend(current, { sendTime, at })
      ? await sendTimeWithin(deps, { schedule: current, caller, sendTime, at, sentCount })
      : ok({ ...scheduleMissed(current, { sendTime, at, sentCount }), sentCount });
    if (!sentOrMissed.isOk) {
      return sentOrMissed;
    }
    const changed = sentOrMissed.value;
    sentCount = changed.sentCount;
    current = changed.schedule;
    await recorded(deps, changed.events);
  }
  await stored(deps, { schedule: current, events: [] });
  return ok(undefined);
}

/** What a schedule's send times are sent with, inside its unit of work: the data keys held among them. */
interface ScheduleSendDeps {
  tx: SendDueSchedulesTx;
  clock: Clock;
  ids: IdGenerator;
  hasher: RequestHasher;
  held: HeldDataKeys;
}

/** A send time's outcome: the schedule as it changed, its events and how many it sent. */
interface SendTimeChanged {
  schedule: Schedule;
  events: NewEvent[];
  sentCount: number;
}

/**
 * One send time: sent as the ship, checked as a send by it now, or refused
 * with its code; a data key it needs and does not hold rolls its unit of work
 * back (decision 0068).
 */
async function sendTimeWithin(
  deps: ScheduleSendDeps,
  sending: { schedule: Schedule; caller: ShipCaller; sendTime: Date; at: Date; sentCount: number },
): Promise<Result<SendTimeChanged, DataKeysNeeded>> {
  const { tx, clock, ids } = deps;
  const { schedule, caller, sendTime, at, sentCount } = sending;
  const { send } = schedule;
  const missingScope = !hasScope(caller, 'messages:send') ? 'messages:send' : send.isForced && !hasScope(caller, 'messages:force') ? 'messages:force' : undefined;
  if (missingScope !== undefined) {
    return ok({ ...scheduleRefused(schedule, { code: 'FORBIDDEN', sendTime, at, sentCount }), sentCount });
  }
  const payload = unsealed(deps.held, { row: { fleetId: schedule.fleetId, rowId: schedule.id }, payload: send.payload });
  if (!payload.isOk) {
    return isDataKeysNeeded(payload.error) ? err(payload.error) : ok({ ...scheduleRefused(schedule, { code: payload.error.kind, sendTime, at, sentCount }), sentCount });
  }
  const inReplyTo = send.inReplyTo ?? undefined;
  const request: CheckedSend = {
    selector: send.selector,
    payload: payload.value,
    contentType: send.contentType,
    model: send.model ?? undefined,
    idempotencyKey: scheduledMessageKey(schedule.id, sendTime),
    inReplyTo,
    isForced: send.isForced,
    requestHash: deps.hasher.hash(sendRequestText({ selector: send.selector, payload: payload.value, contentType: send.contentType, inReplyTo, isForced: send.isForced })),
    sealedRequestHash: deps.hasher.hash(sendRequestText({ selector: send.selector, payload: undefined, contentType: send.contentType, inReplyTo, isForced: send.isForced })),
    scheduledFor: { scheduleId: schedule.id, sendTime },
  };
  const sent = await sendWithin({ tx, clock, ids, held: deps.held }, { caller, request });
  if (!sent.isOk) {
    const { error } = sent;
    return isDataKeysNeeded(error) ? err(error) : ok({ ...scheduleRefused(schedule, { code: error.kind, sendTime, at, sentCount }), sentCount });
  }
  return ok({ ...scheduleSent(schedule, { messageId: sent.value.messageId, sendTime, at, sentCount: sentCount + 1 }), sentCount: sentCount + 1 });
}

async function recorded(deps: { tx: SendDueSchedulesTx; ids: IdGenerator }, events: readonly NewEvent[]): Promise<void> {
  for (const event of events) {
    await recordEvent({ events: deps.tx.events, ids: deps.ids }, event);
  }
}

/** Stores the schedule as it changed and its events, and tells the timers of a next attempt. */
async function stored(deps: { tx: SendDueSchedulesTx; ids: IdGenerator }, changed: { schedule: Schedule; events: NewEvent[] }): Promise<void> {
  const { tx } = deps;
  const { schedule, events } = changed;
  await tx.schedules.save(schedule);
  await recorded(deps, events);
  if (schedule.state === 'active' && schedule.nextAttemptAt !== null) {
    await tx.scheduleNotifier.scheduleDue({ fleetId: schedule.fleetId, scheduleId: schedule.id, attemptAt: schedule.nextAttemptAt });
  }
}
