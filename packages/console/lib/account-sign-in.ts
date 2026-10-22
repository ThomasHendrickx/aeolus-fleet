import { authorizeUrlOf, codeChallengeOf, cookieValueOf, exchangeSignIn, fleetsOf, randomUrlSafe, redeemCode, revokeSignIn, SHARED_SIGN_IN_COOKIE, type Pagasae } from './pagasae';
import { sessionCookieOf } from './plugin-call';
import { SESSION_COOKIE, sessionOf } from './console-gate';
import { returnPathOf } from './return-path';
import { consoleOriginOf } from './console-origin';
import { serverInternalUrlFrom } from './server-url';
import { NO_RIGHTS_PATH, UNREACHABLE_PATH } from './sign-in-paths';

/**
 * An account's sign-in to the console, on the web app's server (accounts
 * design, F1; header design, H5): through pagasae's shared sign-in, then an
 * account token for the fleet in view, which core keeps in its token cookie.
 * No lease is taken, and many accounts sign in at once.
 */

type Environment = Readonly<Record<string, string | undefined>>;

/** The sign-in in flight between /sign-in/start and /sign-in/done: its state, PKCE verifier and where to go after. */
const FLOW_COOKIE = 'aeolus_sign_in_flow';

/** The fleet the account chose last, kept by the console: the hosted console has no fleet in its address. */
export const FLEET_COOKIE = 'aeolus_console_fleet';

const FLOW_LIFE_SECONDS = 600;
const FLEET_COOKIE_LIFE_SECONDS = 400 * 24 * 60 * 60;
const PRESENT_TIMEOUT_MS = 10_000;


/** A 303 to a path, uncached, with the cookies given. */
export function redirectTo(location: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const cookie of cookies) {
    headers.append('set-cookie', cookie);
  }
  return new Response(null, { status: 303, headers });
}

/** The console's own cookie attributes: httpOnly and Secure, Lax so pagasae's redirect back carries it. */
function consoleCookie(name: string, cookie: { value: string; maxAgeSeconds: number; path?: string }): string {
  return `${name}=${cookie.value}; Max-Age=${String(cookie.maxAgeSeconds)}; Path=${cookie.path ?? '/'}; HttpOnly; Secure; SameSite=Lax`;
}

/** What the sign-in steps run with: pagasae, and the web app's environment for the fleet server. */
export interface SignInDeps {
  pagasae: Pagasae;
  environment: Environment;
}

function redirectUriOf(request: Request, environment: Environment): string {
  return `${consoleOriginOf(request, environment)}/sign-in/done`;
}

/** Starts the sign-in: to pagasae's sign-in with a fresh state and PKCE verifier, kept in a short cookie for the way back. */
export async function startSignIn(request: Request, deps: SignInDeps): Promise<Response> {
  const { pagasae, environment } = deps;
  const state = randomUrlSafe();
  const verifier = randomUrlSafe();
  const returnTo = returnPathOf(new URL(request.url).searchParams.get('returnTo'));
  const flow = Buffer.from(JSON.stringify({ state, verifier, returnTo })).toString('base64url');
  const location = authorizeUrlOf(pagasae, {
    redirectUri: redirectUriOf(request, environment),
    state,
    codeChallenge: await codeChallengeOf(verifier),
  });
  return redirectTo(location, [
    consoleCookie(FLOW_COOKIE, {
      value: flow,
      maxAgeSeconds: FLOW_LIFE_SECONDS,
      path: '/sign-in',
    }),
  ]);
}

function flowOf(request: Request): { state: string; verifier: string; returnTo: string } | undefined {
  const value = cookieValueOf(request.headers.get('cookie'), FLOW_COOKIE);
  if (value === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (typeof parsed === 'object' && parsed !== null && 'state' in parsed && 'verifier' in parsed && 'returnTo' in parsed) {
      const { state, verifier, returnTo } = parsed;
      if (typeof state === 'string' && typeof verifier === 'string' && typeof returnTo === 'string') {
        return { state, verifier, returnTo: returnPathOf(returnTo) };
      }
    }
  } catch {
    // A cookie the console did not write: no flow.
  }
  return undefined;
}

/** Back from pagasae: the state must be the one this browser started with; the code is redeemed, then the account enters the fleet. */
export async function finishSignIn(request: Request, deps: SignInDeps): Promise<Response> {
  const { pagasae, environment } = deps;
  const params = new URL(request.url).searchParams;
  const flow = flowOf(request);
  const cleared = consoleCookie(FLOW_COOKIE, {
    value: '',
    maxAgeSeconds: 0,
    path: '/sign-in',
  });
  const code = params.get('code');
  if (flow === undefined || code === null || params.get('state') !== flow.state) {
    return redirectTo('/sign-in/failed', [cleared]);
  }
  if (
    !(await redeemCode(
      { pagasae },
      {
        code,
        redirectUri: redirectUriOf(request, environment),
        codeVerifier: flow.verifier,
      },
    ))
  ) {
    return redirectTo('/sign-in/failed', [cleared]);
  }
  const entered = await enterFleet(request, {
    ...deps,
    returnTo: flow.returnTo,
  });
  entered.headers.append('set-cookie', cleared);
  return entered;
}

/** The fleet to enter: the one chosen last while the account still has rights in it, else the first that opens the console, else the first. */
export function fleetToEnter(fleets: readonly { id: string; hasConsole: boolean }[], chosen: string | undefined): string | undefined {
  return (fleets.find(({ id }) => id === chosen) ?? fleets.find(({ hasConsole }) => hasConsole) ?? fleets[0])?.id;
}

/** Presents the account token to core, which checks it and answers its token cookie; none when core refuses it or does not answer. */
async function presentToCore(token: string, environment: Environment): Promise<string | undefined> {
  try {
    const answer = await fetch(`${serverInternalUrlFrom(environment)}/trpc/console.presentAccountToken`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
      signal: AbortSignal.timeout(PRESENT_TIMEOUT_MS),
    });
    return answer.ok ? (answer.headers.get('set-cookie') ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Clears argo's session cookie once that sign-in has ended, as when someone
 * took argo over: an ended argo session beside the fresh account token would
 * still answer for the browser and keep the account out. Core clears it, as
 * it set it. A live argo session, or core not answering, keeps it.
 */
async function endedArgoSessionCleared(request: Request, environment: Environment): Promise<string[]> {
  const session = cookieValueOf(request.headers.get('cookie'), SESSION_COOKIE);
  if (session === undefined) {
    return [];
  }
  const cookie = `${SESSION_COOKIE}=${session}`;
  const state = await sessionOf(new Request(request.url, { headers: { cookie } }), { serverUrl: serverInternalUrlFrom(environment) });
  if (state !== 'ended' && state !== 'signedInElsewhere') {
    return [];
  }
  try {
    const answer = await fetch(`${serverInternalUrlFrom(environment)}/trpc/console.signOut`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: consoleOriginOf(request, environment) },
      body: '{}',
      cache: 'no-store',
      signal: AbortSignal.timeout(PRESENT_TIMEOUT_MS),
    });
    return answer.headers.getSetCookie();
  } catch {
    return [];
  }
}

/**
 * With the shared sign-in, into a fleet: an account token for it from
 * pagasae, kept by core in its token cookie, then on to the page asked for,
 * clearing argo's sign-in once it ended.
 * No shared sign-in, or one that ended, starts the sign-in again; no rights
 * goes to say so; pagasae not answering says that.
 */
export async function enterFleet(request: Request, deps: SignInDeps & { returnTo: string }): Promise<Response> {
  const { pagasae, environment, returnTo } = deps;
  const cookies = request.headers.get('cookie');
  const signIn = cookieValueOf(cookies, SHARED_SIGN_IN_COOKIE);
  const startAgain = `/sign-in/start?returnTo=${encodeURIComponent(returnTo)}`;
  if (signIn === undefined) {
    return redirectTo(startAgain);
  }
  const fleets = await fleetsOf({ pagasae }, signIn);
  if (fleets === 'ended') {
    return redirectTo(startAgain);
  }
  if (fleets === 'unreachable') {
    return redirectTo(UNREACHABLE_PATH);
  }
  const fleetId = fleetToEnter(fleets, cookieValueOf(cookies, FLEET_COOKIE));
  if (fleetId === undefined) {
    return redirectTo(NO_RIGHTS_PATH);
  }
  const exchanged = await exchangeSignIn({ pagasae }, { signIn, fleetId });
  switch (exchanged.kind) {
    case 'ended':
      return redirectTo(startAgain);
    case 'noRights':
      return redirectTo(NO_RIGHTS_PATH);
    case 'unreachable':
      return redirectTo(UNREACHABLE_PATH);
    case 'token': {
      const tokenCookie = await presentToCore(exchanged.token, environment);
      return tokenCookie === undefined
        ? redirectTo('/sign-in/failed')
        : redirectTo(returnTo, [
            tokenCookie,
            ...(await endedArgoSessionCleared(request, environment)),
            consoleCookie(FLEET_COOKIE, {
              value: fleetId,
              maxAgeSeconds: FLEET_COOKIE_LIFE_SECONDS,
            }),
          ]);
    }
  }
}

/** What a renewal came to: fresh cookies, or why there are none. */
export type Renewal = { kind: 'renewed'; cookies: readonly string[] } | { kind: 'ended' } | { kind: 'noRights' } | { kind: 'unreachable' };

/**
 * A fresh account token for the fleet the account is in, with the shared
 * sign-in (accounts design, A3), kept by core in its token cookie. Ended when
 * the shared sign-in is gone or pagasae refuses it (signed out elsewhere, or
 * disabled: F5); no rights when the account holds none in the fleet any more
 * (F6); unreachable when pagasae or core does not answer (F7).
 */
export async function renewAccountToken(request: Request, deps: SignInDeps): Promise<Renewal> {
  const { pagasae, environment } = deps;
  const cookies = request.headers.get('cookie');
  const signIn = cookieValueOf(cookies, SHARED_SIGN_IN_COOKIE);
  const fleetId = cookieValueOf(cookies, FLEET_COOKIE);
  if (signIn === undefined || fleetId === undefined) {
    return { kind: 'ended' };
  }
  const exchanged = await exchangeSignIn({ pagasae }, { signIn, fleetId });
  if (exchanged.kind !== 'token') {
    return exchanged;
  }
  const tokenCookie = await presentToCore(exchanged.token, environment);
  return tokenCookie === undefined ? { kind: 'unreachable' } : { kind: 'renewed', cookies: [tokenCookie] };
}

/** The renewal route's answer to the browser: the fresh cookie, or what came instead, as JSON. */
export function renewalResponseOf(renewal: Renewal): Response {
  const status = { renewed: 200, ended: 401, noRights: 403, unreachable: 503 }[renewal.kind];
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  for (const cookie of renewal.kind === 'renewed' ? renewal.cookies : []) {
    headers.append('set-cookie', cookie);
  }
  return new Response(JSON.stringify({ outcome: renewal.kind }), { status, headers });
}

/**
 * Signs the account out: the shared sign-in ends at pagasae, everywhere
 * (header design, H5), and core clears its token cookie. A failure at pagasae
 * still clears the console's side.
 */
export async function signOutAccount(request: Request, deps: SignInDeps): Promise<Response> {
  const { pagasae, environment } = deps;
  const cookies = request.headers.get('cookie');
  const signIn = cookieValueOf(cookies, SHARED_SIGN_IN_COOKIE);
  if (signIn !== undefined) {
    await revokeSignIn({ pagasae }, signIn);
  }
  const cleared: string[] = [];
  try {
    const answer = await fetch(`${serverInternalUrlFrom(environment)}/trpc/console.signOut`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookieOf(cookies),
        origin: consoleOriginOf(request, environment),
      },
      body: '{}',
      cache: 'no-store',
      signal: AbortSignal.timeout(PRESENT_TIMEOUT_MS),
    });
    cleared.push(...answer.headers.getSetCookie());
  } catch {
    // Core did not answer: the token ends within 10 minutes by itself.
  }
  return redirectTo('/sign-in?signed=out', cleared);
}
