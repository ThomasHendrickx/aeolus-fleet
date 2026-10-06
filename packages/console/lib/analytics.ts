import { z } from 'zod';

/**
 * The console's usage analytics (decision 0025): a closed list of events,
 * each with the only properties it may carry. No names, ids, payloads or
 * anything a person typed: a pageview carries the route's pattern
 * (`/ships/[shipId]`), never the id in it. The browser and the web app's
 * server parse with the same schema; anything else is dropped.
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

/** Which kind of console session an event comes from (decision 0022). */
export type SessionKind = 'operator' | 'viewer';

/**
 * A pathname as its route's pattern: each dynamic parameter's value back to
 * its name, so `/ships/shp_01...` reads `/ships/[shipId]`.
 */
export function routePatternOf(pathname: string, params: Readonly<Record<string, string | string[] | undefined>>): string {
  return pathname
    .split('/')
    .map((segment) => {
      const decoded = safeDecode(segment);
      const name = Object.entries(params).find(([, value]) => value === decoded || (Array.isArray(value) && value.includes(decoded)))?.[0];
      return name === undefined ? segment : `[${name}]`;
    })
    .join('/');
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
