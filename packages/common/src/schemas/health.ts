/**
 * A fleet's health (decision 0042): where its deliveries are stuck now, the
 * trend over the last 7 days and what was acknowledged in the last 24 hours.
 * Facts with no thresholds; the console and a hosting service judge them.
 */
import { z } from 'zod';

import { partySchema } from './history.js';

/** Why a delivery is stuck, one cause each (docs/blueprint.md, "Stuck"). */
export const STUCK_CAUSES = ['undeliverable', 'noShipCanTake', 'waitingForCrew', 'stalledInFlight'] as const;
export const stuckCauseSchema = z.enum(STUCK_CAUSES);
export type StuckCause = z.infer<typeof stuckCauseSchema>;

/** How many hours the trend counts, the last one now: 7 days. */
export const STUCK_TREND_HOURS = 7 * 24;

/** The trierarch a ship's crew request is assigned to, and when its crew last called; none while it holds no lease. */
export const machineSchema = partySchema.extend({ lastSeenAt: z.iso.datetime().nullable() });

/** Where deliveries are stuck: a ship with the machine behind it, if any, or the type they were sent to. */
export const stuckPlaceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ship'), ship: partySchema, machine: machineSchema.nullable() }),
  z.object({ kind: z.literal('type'), type: z.string() }),
]);

/** The deliveries stuck at one place for one cause: how many, and since when the oldest waits. */
export const stuckPlaceHealthSchema = z.object({
  cause: stuckCauseSchema,
  place: stuckPlaceSchema,
  count: z.int().min(1),
  oldestSince: z.iso.datetime(),
});

/** How many deliveries were stuck at each hour of the last 7 days, oldest first, the last one now. */
export const stuckPerHourSchema = z.array(z.object({ at: z.iso.datetime(), count: z.int().min(0) })).length(STUCK_TREND_HOURS);

/** The deliveries acknowledged in the last 24 hours, and the median from send to acknowledgement; none when there were none. */
export const acknowledgedSchema = z.object({ count: z.int().min(0), medianMs: z.number().min(0).nullable() });

/** Output of `fleet.health`: the caller's fleet's stuck places, oldest waiting first, its trend and its acknowledged. */
export const healthOutputSchema = z.object({
  stuck: z.array(stuckPlaceHealthSchema),
  stuckPerHour: stuckPerHourSchema,
  acknowledged: acknowledgedSchema,
});

export type Health = z.infer<typeof healthOutputSchema>;
