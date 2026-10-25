import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { durationMs } from '../rules/duration.js';
import { idempotencyKeySchema } from './idempotency-key.js';
import { contentTypeSchema, modelSchema, payloadSchema, shipOrTypeSelectorSchema } from './message.js';
import { pageInputOf, pageOutputOf } from './page.js';

/**
 * Inputs and outputs of scheduled messages (decision 0062): making a schedule
 * (`ship.schedule`), listing a ship's schedules (`ship.schedules`,
 * `fleet.schedules`) and cancelling one (`ship.cancelSchedule`,
 * `fleet.cancelSchedule`).
 */

export { durationMs } from '../rules/duration.js';

/** ISO 8601 in UTC. */
const isoTime = z.iso.datetime();

/** The prefix of the idempotency key of every message a schedule sends: no live send may use it. */
export const SCHEDULE_IDEMPOTENCY_KEY_PREFIX = 'schedule:';

/** A schedule's state: it sends while active, and an ended or cancelled one never sends again. */
export const SCHEDULE_STATES = ['active', 'paused', 'ended', 'cancelled'] as const;

export const scheduleStateSchema = z.enum(SCHEDULE_STATES);

export type ScheduleState = z.infer<typeof scheduleStateSchema>;

/** What a refused send time does, the creator's choice (S7): record it and go on, try again within the retry window, or pause. */
export const REFUSAL_STRATEGIES = ['skip', 'retry', 'pause'] as const;

export const refusalStrategySchema = z.enum(REFUSAL_STRATEGIES);

export type RefusalStrategy = z.infer<typeof refusalStrategySchema>;

/** An ISO 8601 duration of a fixed length, such as PT30M or P1D. */
export const durationSchema = z.string().refine((text) => durationMs(text) !== undefined, 'A duration is ISO 8601 of weeks, or days, hours, minutes and seconds, such as PT30M or P1D');

/** When a schedule sends: once, at an instant with its offset. */
export const scheduleTimingSchema = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('once'), at: z.iso.datetime({ offset: true }) })]);

export type ScheduleTiming = z.infer<typeof scheduleTimingSchema>;

/**
 * Input of `ship.schedule` (messages:send, and messages:force when forced): a
 * whole send input, stored as given, the model the ship states, the timing,
 * what a refused send time does and the ship's idempotency key.
 */
export const scheduleInputSchema = z.object({
  selector: shipOrTypeSelectorSchema,
  payload: payloadSchema,
  /** Without it, the payload is text/plain. */
  contentType: contentTypeSchema.optional(),
  model: modelSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
  inReplyTo: idSchema('message').optional(),
  isForced: z.boolean().optional(),
  timing: scheduleTimingSchema,
  /** skip unless given. */
  onRefused: refusalStrategySchema.optional(),
  /** How long after its send time a refused send is tried again under retry; PT1H unless given. */
  retryWindow: durationSchema.optional(),
});

export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

/** Output of `ship.schedule`: the schedule's id, the original one when the key was used before. */
export const scheduleOutputSchema = z.object({ scheduleId: idSchema('schedule') });

/** A send time's outcome: the message it stored, or the code it was refused with. */
export const scheduleOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sent'), messageId: idSchema('message'), sendTime: isoTime, at: isoTime }),
  z.object({ kind: z.literal('refused'), code: z.string(), sendTime: isoTime, at: isoTime }),
]);

/** One schedule as a list shows it: its send input but the payload, its timing and strategy, its state, next send time and last outcome. */
export const scheduleItemSchema = z.object({
  scheduleId: idSchema('schedule'),
  shipId: idSchema('ship'),
  state: scheduleStateSchema,
  selector: shipOrTypeSelectorSchema,
  contentType: z.string(),
  inReplyTo: idSchema('message').nullable(),
  isForced: z.boolean(),
  timing: z.discriminatedUnion('kind', [z.object({ kind: z.literal('once'), at: isoTime })]),
  onRefused: refusalStrategySchema,
  retryWindow: z.string(),
  /** None once it ended or was cancelled. */
  nextSendTime: isoTime.nullable(),
  lastOutcome: scheduleOutcomeSchema.nullable(),
  createdAt: isoTime,
  endedAt: isoTime.nullable(),
  cancelledAt: isoTime.nullable(),
});

export type ScheduleItem = z.infer<typeof scheduleItemSchema>;

/** Input of `ship.schedules`: a page, newest first; active and paused ones unless `states` names others. */
export const schedulesInputSchema = pageInputOf(idSchema('schedule')).extend({ states: z.array(scheduleStateSchema).min(1).optional() });

export type SchedulesInput = z.infer<typeof schedulesInputSchema>;

/** Input of `fleet.schedules` (fleet:manage): the ship whose schedules to list, as `ship.schedules` lists them. */
export const fleetSchedulesInputSchema = schedulesInputSchema.extend({ shipId: idSchema('ship') });

export const schedulesOutputSchema = pageOutputOf(scheduleItemSchema, idSchema('schedule'));

/** Input of `ship.cancelSchedule` and `fleet.cancelSchedule`. */
export const cancelScheduleInputSchema = z.object({ scheduleId: idSchema('schedule') });

export const cancelScheduleOutputSchema = z.object({ scheduleId: idSchema('schedule'), state: z.literal('cancelled') });
