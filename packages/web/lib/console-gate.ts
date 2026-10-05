import { hostedSignInUrlFrom } from './hosted-sign-in';

/** The server's session cookie (the server sets it; the web app only forwards it). */
export const SESSION_COOKIE = 'aeolus_session';

/** How long the web app's server waits for the session check before it lets the console decide in the browser. */
const SESSION_CHECK_TIMEOUT_MS = 3000;

/** Where a request without a session goes: the hosting service's sign-in when AEOLUS_HOSTED_SIGN_IN_URL is set, the console's own otherwise. */
export function signInUrlFor(environment: Readonly<Record<string, string | undefined>>, requestUrl: string): URL {
  return new URL(hostedSignInUrlFrom(environment) ?? '/sign-in', requestUrl);
}

/**
 * Whether the request's session cookie names a live console session, asked of
 * the server's `console.session` (decision 0012): true or false, or undefined
 * when the server did not answer, so the console decides in the browser as it
 * would without this check.
 */
export async function hasLiveSession(request: { serverUrl: string; cookie: string }, fetchImplementation: typeof fetch = fetch): Promise<boolean | undefined> {
  try {
    const response = await fetchImplementation(`${request.serverUrl}/trpc/console.session`, {
      headers: { cookie: request.cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS),
    });
    if (response.ok) {
      return true;
    }
    return response.status === 401 ? false : undefined;
  } catch {
    return undefined;
  }
}
