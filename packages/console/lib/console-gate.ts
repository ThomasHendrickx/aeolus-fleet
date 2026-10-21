import { isSignedInElsewhere } from './errors';
import { hostedSignInUrlFrom } from './hosted-sign-in';
import { pagasaeFrom } from './pagasae';

/** The server's session cookie (the server sets it; the web app only forwards it). */
export const SESSION_COOKIE = 'aeolus_session';

/** The server's cookie of an account's sign-in, holding its account token (accounts design, F1). */
export const ACCOUNT_TOKEN_COOKIE = 'aeolus_account_token';

/** How long the web app's server waits for the session check before it lets the console decide in the browser. */
const SESSION_CHECK_TIMEOUT_MS = 3000;
const UNAUTHORIZED = 401;

/**
 * Where a request without a session goes. When the operator signed in
 * somewhere else, the console's own sign-in says so, as a read or call that
 * hears it does (lib/session.ts), hosted or not: a hosted console shows the
 * notice there before the hosting service's sign-in. Otherwise the hosting
 * service's sign-in when AEOLUS_HOSTED_SIGN_IN_URL is set, the console's own
 * when not. Where the console signs accounts in through pagasae, back into
 * the fleet at once with the shared sign-in, or through pagasae's sign-in
 * without it, coming back to the page asked for.
 */
export function signInUrlFor(
  environment: Readonly<Record<string, string | undefined>>,
  { requestUrl, ended = 'ended', hasSharedSignIn = false }: { requestUrl: string; ended?: 'ended' | 'signedInElsewhere'; hasSharedSignIn?: boolean },
): URL {
  if (ended === 'signedInElsewhere') {
    return new URL('/sign-in?notice=signed-in-elsewhere', requestUrl);
  }
  if (pagasaeFrom(environment) !== undefined) {
    const asked = new URL(requestUrl);
    const url = new URL(hasSharedSignIn ? '/sign-in/enter' : '/sign-in/start', requestUrl);
    url.search = new URLSearchParams({ returnTo: `${asked.pathname}${asked.search}` }).toString();
    return url;
  }
  const hosted = hostedSignInUrlFrom(environment);
  return new URL(hosted ?? '/sign-in', requestUrl);
}

/**
 * Where the request's console session stands: live, ended (no session cookie,
 * or the server refuses it), ended because the operator signed in somewhere
 * else, unknown when the server does not answer, or live for an account
 * that holds no fleet:read, which the console has nothing for (accounts
 * design, A8).
 */
export type SessionState = 'live' | 'ended' | 'signedInElsewhere' | 'unknown' | 'nothingToManage';

/** Whether the server's answer is an account's sign-in without fleet:read. */
async function hasNothingToManage(response: Response): Promise<boolean> {
  try {
    const body: unknown = await response.json();
    const data = typeof body === 'object' && body !== null && 'result' in body && typeof body.result === 'object' && body.result !== null && 'data' in body.result ? body.result.data : undefined;
    if (typeof data !== 'object' || data === null || !('kind' in data) || data.kind !== 'account' || !('scopes' in data) || !Array.isArray(data.scopes)) {
      return false;
    }
    return !data.scopes.includes('fleet:read');
  } catch {
    return false;
  }
}

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
      return (await hasNothingToManage(response)) ? 'nothingToManage' : 'live';
    }
    return response.status === UNAUTHORIZED ? await refusedSessionOf(response) : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The request's session as the server knows it; without a session cookie it is ended, and the server is asked nothing. */
export async function sessionOf(request: Request, at: { serverUrl: string; fetchImplementation?: typeof fetch }): Promise<SessionState> {
  const cookie = request.headers.get('cookie') ?? '';
  const hasSessionCookie = cookie.split(';').some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`) || part.trim().startsWith(`${ACCOUNT_TOKEN_COOKIE}=`));
  if (!hasSessionCookie) {
    return 'ended';
  }
  return askedSessionOf({ serverUrl: at.serverUrl, cookie }, at.fetchImplementation ?? fetch);
}
