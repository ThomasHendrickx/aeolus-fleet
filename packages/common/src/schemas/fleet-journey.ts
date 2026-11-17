/** Installation-only, payload-free fleet journey facts for a hosting service. Missing summaries mean unavailable. */
import { z } from 'zod';

import { idSchema } from '../ids/index.js';

const milestoneSchema = z.object({
  key: z.enum(['fleet-ready', 'first-ship-crewed', 'two-ships-crewed', 'first-message', 'first-value', 'repeat-value']),
  label: z.string(),
  definitionVersion: z.string(),
  occurredAt: z.iso.datetime().nullable(),
  computedAt: z.iso.datetime(),
  coverageFrom: z.iso.datetime(),
  state: z.enum(['reached', 'not-yet', 'unknown']),
});

export const fleetJourneySummarySchema = z.object({
  milestones: z.array(milestoneSchema),
  firstValueDefinition: z.object({ label: z.literal('First value'), version: z.literal('round-trip-v1'), definition: z.string() }),
  computedAt: z.iso.datetime(),
  coverageFrom: z.iso.datetime(),
  processedThrough: z.int().min(0),
  activityDates: z.array(z.iso.date()).max(90),
  activityDatesLast7Days: z.array(z.iso.date()).max(7),
  activityDatesLast28Days: z.array(z.iso.date()).max(28),
  latestQualifyingActivityAt: z.iso.datetime().nullable(),
});
export type FleetJourneySummary = z.infer<typeof fleetJourneySummarySchema>;

/** Twenty resources per call; the opaque cursor is issued by core and replayable. */
export const installationFleetPageInputSchema = z.strictObject({ cursor: z.string().max(2048).optional() });
export const installationFleetPageOutputSchema = z.object({
  items: z.array(z.object({ fleetId: idSchema('fleet'), journey: fleetJourneySummarySchema })),
  nextCursor: z.string().nullable(),
});
export const installationFleetChangesOutputSchema = z.object({
  items: z.array(z.object({ fleetId: idSchema('fleet'), isDeleted: z.boolean(), journey: fleetJourneySummarySchema.nullable() })),
  nextCursor: z.string(),
  hasMore: z.boolean(),
});
