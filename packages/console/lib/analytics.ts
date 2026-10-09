/**
 * The console's usage analytics (decision 0025): a closed list of events,
 * each with the only properties it may carry. No names, ids, payloads or
 * anything a person typed: a pageview carries the route's pattern
 * (`/ships/[shipId]`), never the id in it. The web app's server parses
 * each with lib/analytics-event.ts; anything else is dropped.
 */

export type { AnalyticsEvent } from './analytics-event';

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
