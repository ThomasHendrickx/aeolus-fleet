import { consoleSessionOutputSchema, type FeatureFlag } from '@aeolus-fleet/common';

/** How long a page waits for the session before it renders as if the flags were on, leaving the call to the page. */
const SESSION_TIMEOUT_MS = 1_500;

/**
 * The fleet's feature flags that are on (decision 0069), asked of the fleet
 * server's console.session on the web app's server with the browser's
 * cookie: unknown when signed out or when the server does not answer in time,
 * so the page goes on and shows sign-in or its own error.
 */
export async function featureFlagsOfSession(input: { serverUrl: string; cookie: string; fetchImplementation?: typeof fetch }): Promise<readonly FeatureFlag[] | undefined> {
  const { serverUrl, cookie, fetchImplementation = fetch } = input;
  if (cookie === '') {
    return undefined;
  }
  try {
    const response = await fetchImplementation(`${serverUrl}/trpc/console.session`, { headers: { cookie }, cache: 'no-store', signal: AbortSignal.timeout(SESSION_TIMEOUT_MS) });
    if (!response.ok) {
      return undefined;
    }
    const body: unknown = await response.json();
    const parsed = consoleSessionOutputSchema.safeParse(
      typeof body === 'object' && body !== null && 'result' in body && typeof body.result === 'object' && body.result !== null && 'data' in body.result ? body.result.data : undefined,
    );
    return parsed.success ? parsed.data.featureFlags : undefined;
  } catch {
    return undefined;
  }
}
