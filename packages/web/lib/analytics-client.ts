'use client';

import { useParams, usePathname } from 'next/navigation';
import { createContext, useContext, useEffect } from 'react';

import { routePatternOf, type AnalyticsEvent } from './analytics';

/**
 * Whether this console sends analytics (decision 0025): true only when the web
 * app's server has an adapter configured, read per request. Off, `track`
 * does nothing and the browser makes no request.
 */
export const AnalyticsContext = createContext(false);

/** Posts one event to the web app's own /api/analytics; never waits on it, never fails the console. */
function send(event: AnalyticsEvent): void {
  void fetch('/api/analytics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => undefined);
}

function ignore(): void {
  // Analytics is off: nothing is sent.
}

/** The analytics port: track an event from the closed list, or nothing at all while analytics is off. */
export function useAnalytics(): { track: (event: AnalyticsEvent) => void } {
  return { track: useContext(AnalyticsContext) ? send : ignore };
}

/** A pageview per page the console shows, carrying the route's pattern, never an id in it. */
export function useAnalyticsPageviews(): void {
  const { track } = useAnalytics();
  const pathname = usePathname();
  const route = routePatternOf(pathname, useParams());
  // The analytics provider is an outside system the page tells it was shown.
  useEffect(() => {
    track({ name: 'pageview', route });
  }, [track, route]);
}
