import type { AnalyticsEvent, SessionKind } from './analytics';
import { createPosthogAdapter } from './analytics-posthog';

/**
 * Where the web app's server sends the console's analytics events (decision
 * 0025): one adapter per provider, chosen by configuration. None is the
 * default: a self-hosted console sends nothing anywhere.
 */
export interface AnalyticsAdapter {
  /** Sends one event as the given anonymous visitor; it may fail, and the console never waits on it. */
  capture(event: AnalyticsEvent, from: { distinctId: string; sessionKind: SessionKind }): Promise<void>;
}

/**
 * The adapter AEOLUS_HOSTED_ANALYTICS_PROVIDER names, with its
 * AEOLUS_HOSTED_ANALYTICS_KEY and AEOLUS_HOSTED_ANALYTICS_HOST (an https URL);
 * none when any of them is missing or not understood.
 */
export function analyticsAdapterFrom(
  environment: Readonly<Record<string, string | undefined>>,
  fetchImplementation: typeof fetch = fetch,
): AnalyticsAdapter | undefined {
  const { AEOLUS_HOSTED_ANALYTICS_PROVIDER: provider, AEOLUS_HOSTED_ANALYTICS_KEY: key, AEOLUS_HOSTED_ANALYTICS_HOST: host } = environment;
  if (key === undefined || key === '' || host === undefined || !URL.canParse(host) || new URL(host).protocol !== 'https:') {
    return undefined;
  }
  return provider === 'posthog' ? createPosthogAdapter({ key, host }, fetchImplementation) : undefined;
}
