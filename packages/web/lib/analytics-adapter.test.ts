import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { analyticsAdapterFrom } from './analytics-adapter';

const POSTHOG = { AEOLUS_HOSTED_ANALYTICS_PROVIDER: 'posthog', AEOLUS_HOSTED_ANALYTICS_KEY: 'phc_key', AEOLUS_HOSTED_ANALYTICS_HOST: 'https://eu.i.posthog.com' };

describe('analyticsAdapterFrom', () => {
  it('is off by default: a self-hosted console sends nothing anywhere', () => {
    expect(analyticsAdapterFrom({})).toBeUndefined();
  });

  it.each([
    ['without a key', { ...POSTHOG, AEOLUS_HOSTED_ANALYTICS_KEY: '' }],
    ['without a host', { ...POSTHOG, AEOLUS_HOSTED_ANALYTICS_HOST: undefined }],
    ['with a host that is not https', { ...POSTHOG, AEOLUS_HOSTED_ANALYTICS_HOST: 'http://eu.i.posthog.com' }],
    ['with a provider it does not know', { ...POSTHOG, AEOLUS_HOSTED_ANALYTICS_PROVIDER: 'other' }],
  ])('is off %s', (_case, environment) => {
    expect(analyticsAdapterFrom(environment)).toBeUndefined();
  });

  it('sends to PostHog when configured for it', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 200 })));

    await analyticsAdapterFrom(POSTHOG, fetchImplementation)?.capture({ name: 'ship_commissioned' }, { distinctId: 'd1', sessionKind: 'operator' });

    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});

describe('the PostHog adapter', () => {
  const sentBody = z.object({ api_key: z.string(), event: z.string(), distinct_id: z.string(), properties: z.record(z.string(), z.unknown()) });

  async function captured(event: Parameters<NonNullable<ReturnType<typeof analyticsAdapterFrom>>['capture']>[0]) {
    const fetchImplementation = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 200 })));
    await analyticsAdapterFrom(POSTHOG, fetchImplementation)?.capture(event, { distinctId: 'visitor-1', sessionKind: 'viewer' });
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    return { url: z.string().parse(url), body: sentBody.parse(JSON.parse(z.string().parse(init?.body))) };
  }

  it("posts an anonymous event to PostHog's capture API, carrying the session kind", async () => {
    const { url, body } = await captured({ name: 'tour_step_reached', step: 2, total: 6 });

    expect(url).toBe('https://eu.i.posthog.com/i/v0/e/');
    expect(body).toEqual({
      api_key: 'phc_key',
      event: 'tour_step_reached',
      distinct_id: 'visitor-1',
      properties: { step: 2, total: 6, sessionKind: 'viewer', $process_person_profile: false },
    });
  });

  it("sends a pageview as PostHog's pageview, with the route pattern as its path", async () => {
    const { body } = await captured({ name: 'pageview', route: '/ships/[shipId]' });

    expect(body.event).toBe('$pageview');
    expect(body.properties).toEqual({ $pathname: '/ships/[shipId]', sessionKind: 'viewer', $process_person_profile: false });
  });
});
