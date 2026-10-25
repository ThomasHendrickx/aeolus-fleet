import { durationMs, SCHEDULE_IDEMPOTENCY_KEY_PREFIX, type FleetId, type MessageId, type MissedStrategy, type RefusalStrategy, type ScheduleId, type ScheduleState, type ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { RecipientSelector } from '../shared/selector.js';
import { cronSendTimeAfter, isKnownTimeZone, parseCron } from './cron.js';

/**
 * A ship's scheduled message (decision 0062): a whole send input that core
 * sends as that ship at its send time. Plain data; the functions here change
 * it and raise its events. Each send time gives one message, or a refusal
 * recorded on the schedule.
 */

/** How long after its send time a refused send is tried again under retry, unless the creator says. */
export const RETRY_WINDOW_DEFAULT = 'PT1H';

/** How long a refused send under retry waits for its next try: one pass of core. */
export const RETRY_EVERY_MS = 30_000;

/** What a missed send time does, unless the creator says: every missed one is sent (S6). */
export const MISSED_STRATEGY_DEFAULT: MissedStrategy = 'each';

/** How late a pass may reach a send time before it is missed, unless the creator says (S6). */
export const GRACE_DEFAULT = 'PT5M';

/** A cron's zone unless the creator says (S1). */
export const TIME_ZONE_DEFAULT = 'UTC';

/** The send input, stored as the creator gave it: the selector as addressed, a name resolved only at each send time. */
export interface ScheduledSend {
  selector: RecipientSelector;
  payload: string;
  contentType: string;
  /** The model the creator stated: every send states it (S13). */
  model: string | null;
  inReplyTo: MessageId | null;
  isForced: boolean;
}

/** Where a repeat begins and ends: at or after its start, at or before its end, and no more sends than its count. */
export interface RepeatBounds {
  start: Date | null;
  end: Date | null;
  count: number | null;
}

/**
 * When it sends (S1): once, at an instant; every fixed duration, from its
 * start or else its creation; or at a cron's wall times in its zone.
 */
export type ScheduleTiming = { kind: 'once'; at: Date } | ({ kind: 'every'; every: string } & RepeatBounds) | ({ kind: 'cron'; cron: string; timeZone: string } & RepeatBounds);

/** The timing as a creator gives it: a repeat's bounds and a cron's zone are optional. */
export type ScheduleTimingInput =
  | { kind: 'once'; at: Date }
  | ({ kind: 'every'; every: string } & Partial<RepeatBounds>)
  | ({ kind: 'cron'; cron: string; timeZone?: string } & Partial<RepeatBounds>);

/** What a send time came to: the message stored, the code it was refused with, or missed (S6). */
export type ScheduleOutcome =
  | { kind: 'sent'; messageId: MessageId; sendTime: Date; at: Date }
  | { kind: 'refused'; code: string; sendTime: Date; at: Date }
  | { kind: 'missed'; sendTime: Date; at: Date };

export interface Schedule {
  id: ScheduleId;
  fleetId: FleetId;
  /** The ship that made it: the only one it sends as. */
  shipId: ShipId;
  send: ScheduledSend;
  timing: ScheduleTiming;
  onRefused: RefusalStrategy;
  /** An ISO 8601 duration of a fixed length, as the creator gave it. */
  retryWindow: string;
  onMissed: MissedStrategy;
  /** How late a send time may be sent on time: an ISO 8601 duration of a fixed length. */
  grace: string;
  idempotencyKey: string;
  requestHash: string;
  state: ScheduleState;
  /** The send time it sends next; none once it ended or was cancelled. */
  nextSendTime: Date | null;
  /** When core next tries: the next send time, or a pass later under retry; none unless active. */
  nextAttemptAt: Date | null;
  lastOutcome: ScheduleOutcome | null;
  createdAt: Date;
  endedAt: Date | null;
  cancelledAt: Date | null;
}

/** How a schedule's last send time went when it ends: sent, refused and skipped, or missed. */
type EndOutcome = 'sent' | 'skipped' | 'missed';

/** Why a schedule was cancelled: by its ship, by a manager, or by its ship's retire. */
export type CancelReason = 'ship' | 'manager' | 'retired';

export type ScheduleRefusal = DomainError<'INVALID_TIMING' | 'INVALID_RETRY_WINDOW' | 'INVALID_GRACE'>;

/** What a creator asks for, its send checked already. */
export interface ScheduleToPlan {
  scheduleId: ScheduleId;
  fleetId: FleetId;
  shipId: ShipId;
  send: ScheduledSend;
  timing: ScheduleTimingInput;
  onRefused: RefusalStrategy | undefined;
  retryWindow: string | undefined;
  onMissed: MissedStrategy | undefined;
  grace: string | undefined;
  idempotencyKey: string;
  requestHash: string;
  at: Date;
}

/**
 * A new schedule, active, its next send time its first, and ScheduleCreated
 * on its ship. Its timing is valid and gives a send time after now: a once
 * schedule in the future, an every of a fixed duration, a cron of five fields
 * in a zone the server knows, an end after its start, a count of at least
 * one. A retry window and a grace are durations of a fixed length.
 */
export function planSchedule(plan: ScheduleToPlan): Result<{ schedule: Schedule; events: NewEvent[] }, ScheduleRefusal> {
  const { at } = plan;
  const timing = timingOf(plan.timing);
  if (!timing.isOk) {
    return timing;
  }
  const retryWindow = plan.retryWindow ?? RETRY_WINDOW_DEFAULT;
  if (durationMs(retryWindow) === undefined) {
    return refuse('INVALID_RETRY_WINDOW', 'A retry window is an ISO 8601 duration of weeks, or days, hours, minutes and seconds, such as PT30M');
  }
  const grace = plan.grace ?? GRACE_DEFAULT;
  if (durationMs(grace) === undefined) {
    return refuse('INVALID_GRACE', 'A grace is an ISO 8601 duration of weeks, or days, hours, minutes and seconds, such as PT5M');
  }
  const firstSendTime = sendTimeAfter({ timing: timing.value, createdAt: at }, at);
  if (firstSendTime === undefined) {
    return refuse('INVALID_TIMING', 'This timing has no send time after now: a once schedule is in the future, and a repeat sends at least once before its end');
  }
  const schedule: Schedule = {
    id: plan.scheduleId,
    fleetId: plan.fleetId,
    shipId: plan.shipId,
    send: plan.send,
    timing: timing.value,
    onRefused: plan.onRefused ?? 'skip',
    retryWindow,
    onMissed: plan.onMissed ?? MISSED_STRATEGY_DEFAULT,
    grace,
    idempotencyKey: plan.idempotencyKey,
    requestHash: plan.requestHash,
    state: 'active',
    nextSendTime: firstSendTime,
    nextAttemptAt: firstSendTime,
    lastOutcome: null,
    createdAt: at,
    endedAt: null,
    cancelledAt: null,
  };
  return ok({
    schedule,
    events: [eventOf(schedule, { type: 'ScheduleCreated', at, actor: { kind: 'ship', shipId: schedule.shipId }, details: { timing: timing.value.kind, nextSendTime: firstSendTime.toISOString() } })],
  });
}

/**
 * The schedule's first send time strictly after an instant, within its start
 * and end; none when it has no more. An every sends on the beat of its start,
 * or else of its creation, never at the creation itself.
 */
export function sendTimeAfter(schedule: Pick<Schedule, 'timing' | 'createdAt'>, after: Date): Date | undefined {
  const { timing } = schedule;
  if (timing.kind === 'once') {
    return timing.at > after ? timing.at : undefined;
  }
  const next = timing.kind === 'every' ? everySendTimeAfter({ every: timing.every, start: timing.start, createdAt: schedule.createdAt }, after) : cronAfter(timing, after);
  return next !== undefined && (timing.end === null || next <= timing.end) ? next : undefined;
}

function everySendTimeAfter(every: { every: string; start: Date | null; createdAt: Date }, after: Date): Date | undefined {
  const intervalMs = durationMs(every.every);
  if (intervalMs === undefined) {
    return undefined;
  }
  const anchorMs = (every.start ?? every.createdAt).getTime();
  const beats = Math.max(every.start === null ? 1 : 0, Math.floor((after.getTime() - anchorMs) / intervalMs) + 1);
  return new Date(anchorMs + beats * intervalMs);
}

function cronAfter(timing: { cron: string; timeZone: string; start: Date | null }, after: Date): Date | undefined {
  const cron = parseCron(timing.cron);
  if (!cron.isOk) {
    return undefined;
  }
  // A send time may fall on the start itself, so look from just before it.
  const from = timing.start !== null && timing.start > after ? new Date(timing.start.getTime() - 1) : after;
  return cronSendTimeAfter({ cron: cron.value, timeZone: timing.timeZone }, from);
}

/** The timing as stored, its defaults filled in, or why it is not valid. */
function timingOf(input: ScheduleTimingInput): Result<ScheduleTiming, ScheduleRefusal> {
  if (input.kind === 'once') {
    return ok(input);
  }
  const bounds: RepeatBounds = { start: input.start ?? null, end: input.end ?? null, count: input.count ?? null };
  if (bounds.count !== null && (!Number.isInteger(bounds.count) || bounds.count < 1)) {
    return refuse('INVALID_TIMING', `A repeat's count is a whole number of sends of at least 1, not ${bounds.count}`);
  }
  if (bounds.start !== null && bounds.end !== null && bounds.end <= bounds.start) {
    return refuse('INVALID_TIMING', `A repeat's end is after its start: ${bounds.end.toISOString()} is not after ${bounds.start.toISOString()}`);
  }
  if (input.kind === 'every') {
    return durationMs(input.every) === undefined
      ? refuse('INVALID_TIMING', `every is an ISO 8601 duration of weeks, or days, hours, minutes and seconds, such as PT6H: "${input.every}" is not one`)
      : ok({ kind: 'every', every: input.every, ...bounds });
  }
  const cron = parseCron(input.cron);
  if (!cron.isOk) {
    return cron;
  }
  const timeZone = input.timeZone ?? TIME_ZONE_DEFAULT;
  if (!isKnownTimeZone(timeZone)) {
    return refuse('INVALID_TIMING', `A cron's zone is an IANA time zone, such as Europe/Brussels: "${timeZone}" is not one this server knows`);
  }
  return ok({ kind: 'cron', cron: input.cron, timeZone, ...bounds });
}

/**
 * The idempotency key of the message a schedule sends at a send time: unique
 * per sender, so a second claim of the same send time stores no second
 * message, and a replay finds the one stored.
 */
export function scheduledMessageKey(scheduleId: ScheduleId, sendTime: Date): string {
  return `${SCHEDULE_IDEMPOTENCY_KEY_PREFIX}${scheduleId}:${sendTime.toISOString()}`;
}

/**
 * The send time sent: the message is its outcome, and the schedule goes on to
 * its next send time, or ends with ScheduleEnded past its end or its count,
 * counting the sends so far with this one.
 */
export function scheduleSent(schedule: Schedule, sent: { messageId: MessageId; sendTime: Date; at: Date; sentCount: number }): { schedule: Schedule; events: NewEvent[] } {
  const { messageId, sendTime, at, sentCount } = sent;
  return advanced({ ...schedule, lastOutcome: { kind: 'sent', messageId, sendTime, at } }, { sendTime, at, sentCount, outcome: 'sent' });
}

/**
 * The send time refused with its code, recorded with ScheduledSendRefused,
 * then the creator's strategy (S7): skip goes on to the next send time, so a
 * once schedule ends; retry keeps the send time and tries again a pass later
 * while inside its window, then skips; pause pauses it, keeping its send
 * time, with SchedulePaused.
 */
export function scheduleRefused(schedule: Schedule, refused: { code: string; sendTime: Date; at: Date; sentCount: number }): { schedule: Schedule; events: NewEvent[] } {
  const { at, sendTime, code, sentCount } = refused;
  const skipped = { sendTime, at, sentCount, outcome: 'skipped' } as const;
  const recorded: Schedule = { ...schedule, lastOutcome: { kind: 'refused', code, sendTime, at } };
  const refusal = eventOf(schedule, {
    type: 'ScheduledSendRefused',
    at,
    actor: { kind: 'ship', shipId: schedule.shipId },
    details: { sendTime: sendTime.toISOString(), code, strategy: schedule.onRefused },
  });
  switch (schedule.onRefused) {
    case 'skip':
      return withEvent(refusal, advanced(recorded, skipped));
    case 'retry':
      return isInsideRetryWindow(schedule, { sendTime, at })
        ? { schedule: { ...recorded, nextAttemptAt: new Date(at.getTime() + RETRY_EVERY_MS) }, events: [refusal] }
        : withEvent(refusal, advanced(recorded, skipped));
    case 'pause':
      return {
        schedule: { ...recorded, state: 'paused', nextAttemptAt: null },
        events: [refusal, eventOf(schedule, { type: 'SchedulePaused', at, actor: { kind: 'ship', shipId: schedule.shipId }, details: {} })],
      };
  }
}

export type CancelRefusal = DomainError<'SCHEDULE_ENDED'>;

/**
 * Cancels an active or paused schedule, with ScheduleCancelled on its ship
 * caused by the actor; a cancelled one stays as it is, with no event, so a
 * retry of a cancel changes nothing. An ended one is refused.
 */
export function cancelSchedule(schedule: Schedule, cancel: { reason: CancelReason; actor: Actor; at: Date }): Result<{ schedule: Schedule; events: NewEvent[] }, CancelRefusal> {
  switch (schedule.state) {
    case 'cancelled':
      return ok({ schedule, events: [] });
    case 'ended':
      return refuse('SCHEDULE_ENDED', `Schedule ${schedule.id} ended: it sends nothing more`);
    case 'active':
    case 'paused':
      return ok({
        schedule: { ...schedule, state: 'cancelled', nextSendTime: null, nextAttemptAt: null, cancelledAt: cancel.at },
        events: [eventOf(schedule, { type: 'ScheduleCancelled', at: cancel.at, actor: cancel.actor, details: { reason: cancel.reason } })],
      });
  }
}

/** Whether a refused send time may still be tried: before its send time plus the retry window. */
function isInsideRetryWindow(schedule: Schedule, refused: { sendTime: Date; at: Date }): boolean {
  return refused.at.getTime() < refused.sendTime.getTime() + (durationMs(schedule.retryWindow) ?? 0);
}

/**
 * Whether a due send time is sent (S6): one kept for a retry, and one the
 * pass reaches within its grace, always; a missed one by the creator's
 * strategy: each sends it, skip does not, once only when it is the latest
 * missed.
 */
export function isSendTimeToSend(schedule: Schedule, due: { sendTime: Date; at: Date }): boolean {
  const { sendTime, at } = due;
  const { lastOutcome } = schedule;
  if (lastOutcome?.kind === 'refused' && lastOutcome.sendTime.getTime() === sendTime.getTime()) {
    return true;
  }
  if (!isMissed(schedule, { sendTime, at })) {
    return true;
  }
  switch (schedule.onMissed) {
    case 'each':
      return true;
    case 'skip':
      return false;
    case 'once': {
      const next = sendTimeAfter(schedule, sendTime);
      return next === undefined || next > at || !isMissed(schedule, { sendTime: next, at });
    }
  }
}

/** The send time missed, not sent (S6): recorded with ScheduledSendMissed and as the last outcome, then on to the next. */
export function scheduleMissed(schedule: Schedule, missed: { sendTime: Date; at: Date; sentCount: number }): { schedule: Schedule; events: NewEvent[] } {
  const { sendTime, at } = missed;
  const record = eventOf(schedule, {
    type: 'ScheduledSendMissed',
    at,
    actor: { kind: 'ship', shipId: schedule.shipId },
    details: { sendTime: sendTime.toISOString(), strategy: schedule.onMissed },
  });
  return withEvent(record, advanced({ ...schedule, lastOutcome: { kind: 'missed', sendTime, at } }, { ...missed, outcome: 'missed' }));
}

/** Whether the pass reaches a send time later than its grace. */
function isMissed(schedule: Schedule, due: { sendTime: Date; at: Date }): boolean {
  return due.at.getTime() - due.sendTime.getTime() > (durationMs(schedule.grace) ?? 0);
}

/** After a send time: on to the next, or ended when it has none or its count of sends is reached. */
function advanced(schedule: Schedule, after: { sendTime: Date; at: Date; sentCount: number; outcome: EndOutcome }): { schedule: Schedule; events: NewEvent[] } {
  const { timing } = schedule;
  const isCountReached = timing.kind !== 'once' && timing.count !== null && after.sentCount >= timing.count;
  const next = isCountReached ? undefined : sendTimeAfter(schedule, after.sendTime);
  return next === undefined ? ended(schedule, after) : { schedule: { ...schedule, nextSendTime: next, nextAttemptAt: next }, events: [] };
}

/** A schedule after its last send time: ended, sending nothing more. */
function ended(schedule: Schedule, end: { at: Date; outcome: EndOutcome }): { schedule: Schedule; events: NewEvent[] } {
  return {
    schedule: { ...schedule, state: 'ended', nextSendTime: null, nextAttemptAt: null, endedAt: end.at },
    events: [eventOf(schedule, { type: 'ScheduleEnded', at: end.at, actor: { kind: 'ship', shipId: schedule.shipId }, details: { outcome: end.outcome } })],
  };
}

function withEvent(first: NewEvent, change: { schedule: Schedule; events: NewEvent[] }): { schedule: Schedule; events: NewEvent[] } {
  return { schedule: change.schedule, events: [first, ...change.events] };
}

/** An event on the schedule's ship, naming the schedule first in its details. */
function eventOf(schedule: Schedule, event: { type: NewEvent['type']; at: Date; actor: Actor; details: Record<string, string> }): NewEvent {
  return { fleetId: schedule.fleetId, type: event.type, occurredAt: event.at, actor: event.actor, shipId: schedule.shipId, details: { scheduleId: schedule.id, ...event.details } };
}
