import { z } from 'zod';

/**
 * The closed list of analytics events (decision 0025), as the web app's
 * server parses what the browser posts to /api/analytics: each event with the
 * only properties it may carry.
 */

/** The longest route pattern a pageview carries. */
const ROUTE_MAX_LENGTH = 100;
/** The most steps a guide has (decision 0024). */
const GUIDE_STEPS_MAX = 10;
/** More roles than any blueprint holds. */
const ROLES_MAX = 100;

const step = z.number().int().min(1).max(GUIDE_STEPS_MAX);

export const analyticsEventSchema = z.discriminatedUnion('name', [
  z.strictObject({ name: z.literal('pageview'), route: z.string().max(ROUTE_MAX_LENGTH).regex(/^\/[a-z0-9\-/[\]]*$/i) }),
  z.strictObject({ name: z.literal('tour_started') }),
  z.strictObject({ name: z.literal('tour_step_reached'), step, total: step }),
  z.strictObject({ name: z.literal('tour_skipped'), step }),
  z.strictObject({ name: z.literal('tour_finished') }),
  z.strictObject({ name: z.literal('ship_commissioned') }),
  z.strictObject({ name: z.literal('squadron_formed'), roleCount: z.number().int().min(0).max(ROLES_MAX) }),
]);

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
