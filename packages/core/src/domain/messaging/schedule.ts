import { durationMs, SCHEDULE_IDEMPOTENCY_KEY_PREFIX, type FleetId, type MessageId, type RefusalStrategy, type ScheduleId, type ScheduleState, type ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { RecipientSelector } from '../shared/selector.js';

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

/** When it sends: once, at an instant. */
export interface ScheduleTiming {
  kind: 'once';
  at: Date;
}

/** What a send time came to: the message stored, or the code it was refused with. */
export type ScheduleOutcome = { kind: 'sent'; messageId: MessageId; sendTime: Date; at: Date } | { kind: 'refused'; code: string; sendTime: Date; at: Date };

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

/** Why a schedule was cancelled: by its ship, by a manager, or by its ship's retire. */
export type CancelReason = 'ship' | 'manager' | 'retired';

export type ScheduleRefusal = DomainError<'INVALID_TIMING' | 'INVALID_RETRY_WINDOW'>;

/** What a creator asks for, its send checked already. */
export interface ScheduleToPlan {
  scheduleId: ScheduleId;
  fleetId: FleetId;
  shipId: ShipId;
  send: ScheduledSend;
  timing: ScheduleTiming;
  onRefused: RefusalStrategy | undefined;
  retryWindow: string | undefined;
  idempotencyKey: string;
  requestHash: string;
  at: Date;
}

/**
 * A new schedule, active, its next send time its instant, and
 * ScheduleCreated on its ship. A once schedule is in the future; a retry
 * window is a duration of a fixed length.
 */
export function planSchedule(plan: ScheduleToPlan): Result<{ schedule: Schedule; events: NewEvent[] }, ScheduleRefusal> {
  const { at, timing } = plan;
  if (timing.at.getTime() <= at.getTime()) {
    return refuse('INVALID_TIMING', `A once schedule is in the future: ${timing.at.toISOString()} is not after ${at.toISOString()}`);
  }
  const retryWindow = plan.retryWindow ?? RETRY_WINDOW_DEFAULT;
  if (durationMs(retryWindow) === undefined) {
    return refuse('INVALID_RETRY_WINDOW', 'A retry window is an ISO 8601 duration of weeks, or days, hours, minutes and seconds, such as PT30M');
  }
  const schedule: Schedule = {
    id: plan.scheduleId,
    fleetId: plan.fleetId,
    shipId: plan.shipId,
    send: plan.send,
    timing,
    onRefused: plan.onRefused ?? 'skip',
    retryWindow,
    idempotencyKey: plan.idempotencyKey,
    requestHash: plan.requestHash,
    state: 'active',
    nextSendTime: timing.at,
    nextAttemptAt: timing.at,
    lastOutcome: null,
    createdAt: at,
    endedAt: null,
    cancelledAt: null,
  };
  return ok({
    schedule,
    events: [eventOf(schedule, { type: 'ScheduleCreated', at, actor: { kind: 'ship', shipId: schedule.shipId }, details: { timing: timing.kind, nextSendTime: timing.at.toISOString() } })],
  });
}

/**
 * The idempotency key of the message a schedule sends at a send time: unique
 * per sender, so a second claim of the same send time stores no second
 * message, and a replay finds the one stored.
 */
export function scheduledMessageKey(scheduleId: ScheduleId, sendTime: Date): string {
  return `${SCHEDULE_IDEMPOTENCY_KEY_PREFIX}${scheduleId}:${sendTime.toISOString()}`;
}

/** The send time sent: the message is its outcome, and a once schedule ends with ScheduleEnded. */
export function scheduleSent(schedule: Schedule, sent: { messageId: MessageId; sendTime: Date; at: Date }): { schedule: Schedule; events: NewEvent[] } {
  const outcome: ScheduleOutcome = { kind: 'sent', ...sent };
  return ended({ ...schedule, lastOutcome: outcome }, { at: sent.at, outcome: 'sent' });
}

/**
 * The send time refused with its code, recorded with ScheduledSendRefused,
 * then the creator's strategy (S7): skip ends a once schedule; retry keeps
 * the send time and tries again a pass later while inside its window, then
 * skips; pause pauses it, keeping its send time, with SchedulePaused.
 */
export function scheduleRefused(schedule: Schedule, refused: { code: string; sendTime: Date; at: Date }): { schedule: Schedule; events: NewEvent[] } {
  const { at, sendTime, code } = refused;
  const recorded: Schedule = { ...schedule, lastOutcome: { kind: 'refused', code, sendTime, at } };
  const refusal = eventOf(schedule, {
    type: 'ScheduledSendRefused',
    at,
    actor: { kind: 'ship', shipId: schedule.shipId },
    details: { sendTime: sendTime.toISOString(), code, strategy: schedule.onRefused },
  });
  switch (schedule.onRefused) {
    case 'skip':
      return withEvent(refusal, ended(recorded, { at, outcome: 'skipped' }));
    case 'retry':
      return isInsideRetryWindow(schedule, { sendTime, at })
        ? { schedule: { ...recorded, nextAttemptAt: new Date(at.getTime() + RETRY_EVERY_MS) }, events: [refusal] }
        : withEvent(refusal, ended(recorded, { at, outcome: 'skipped' }));
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

/** A once schedule after its send time: ended, sending nothing more. */
function ended(schedule: Schedule, end: { at: Date; outcome: 'sent' | 'skipped' }): { schedule: Schedule; events: NewEvent[] } {
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
