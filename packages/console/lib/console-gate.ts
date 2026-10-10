import { isSignedInElsewhere } from './errors';
import { hostedSignInUrlFrom } from './hosted-sign-in';

/** The server's session cookie (the server sets it; the web app only forwards it). */
export const SESSION_COOKIE = 'aeolus_session';

/** How long the web app's server waits for the session check before it lets the console decide in the browser. */
const SESSION_CHECK_TIMEOUT_MS = 3000;
const UNAUTHORIZED = 401;

/** Where a request without a session goes: the hosting service's sign-in when AEOLUS_HOSTED_SIGN_IN_URL is set, the console's own otherwise. */
export function signInUrlFor(environment: Readonly<Record<string, string | undefined>>, requestUrl: string): URL {
  return new URL(hostedSignInUrlFrom(environment) ?? '/sign-in', requestUrl);
}

/** Where the request's console session stands: live, ended (no session cookie, or the server refuses it), ended because the operator signed in somewhere else, or unknown when the server does not answer. */
export type SessionState = 'live' | 'ended' | 'signedInElsewhere' | 'unknown';

/** The server's answer to a session it refuses: the refusal's error data says when a sign-in elsewhere ended it. */
async function refusedSessionOf(response: Response): Promise<'ended' | 'signedInElsewhere'> {
  try {
    const body: unknown = await response.json();
    const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined;
    return isSignedInElsewhere(error) ? 'signedInElsewhere' : 'ended';
  } catch {
    return 'ended';
  }
}

/** The session the cookie names, asked of the server's `console.session` (decision 0012). */
async function askedSessionOf(request: { serverUrl: string; cookie: string }, fetchImplementation: typeof fetch): Promise<SessionState> {
  try {
    const response = await fetchImplementation(`${request.serverUrl}/trpc/console.session`, {
      headers: { cookie: request.cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS),
    });
    if (response.ok) {
      return 'live';
    }
    return response.status === UNAUTHORIZED ? await refusedSessionOf(response) : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Whether the request's session cookie names a live console session, asked of
 * the server's `console.session` (decision 0012): true or false, or undefined
 * when the server did not answer, so the console decides in the browser as it
 * would without this check.
 */
export async function hasLiveSession(request: { serverUrl: string; cookie: string }, fetchImplementation: typeof fetch = fetch): Promise<boolean | undefined> {
  const session = await askedSessionOf(request, fetchImplementation);
  return session === 'unknown' ? undefined : session === 'live';
}

/** The request's session as the server knows it; without a session cookie it is ended, and the server is asked nothing. */
export async function sessionOf(request: Request, at: { serverUrl: string; fetchImplementation?: typeof fetch }): Promise<SessionState> {
  const cookie = request.headers.get('cookie') ?? '';
  const hasSessionCookie = cookie.split(';').some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));
  if (!hasSessionCookie) {
    return 'ended';
  }
  return askedSessionOf({ serverUrl: at.serverUrl, cookie }, at.fetchImplementation ?? fetch);
}
