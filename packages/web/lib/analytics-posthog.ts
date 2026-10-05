import type { AnalyticsAdapter } from './analytics-adapter';

/** How long the web app's server waits for PostHog before it gives the event up. */
const CAPTURE_TIMEOUT_MS = 3000;

/**
 * The PostHog adapter (decision 0025): one call to PostHog's capture API per
 * event, with fetch, from the web app's server. No SDK and nothing in the
 * browser. Events are anonymous: no person profile, and PostHog sees only
 * the web app's server, never the visitor's address. The only file that
 * names the vendor, with its configuration.
 */
export function createPosthogAdapter(config: { key: string; host: string }, fetchImplementation: typeof fetch): AnalyticsAdapter {
  const url = new URL('/i/v0/e/', config.host).toString();
  return {
    capture: async (event, from) => {
      const { name, ...properties } = event;
      const isPageview = name === 'pageview';
      await fetchImplementation(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: config.key,
          event: isPageview ? '$pageview' : name,
          distinct_id: from.distinctId,
          properties: {
            ...(isPageview ? { $pathname: event.route } : properties),
            sessionKind: from.sessionKind,
            $process_person_profile: false,
          },
        }),
        signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
      });
    },
  };
}
