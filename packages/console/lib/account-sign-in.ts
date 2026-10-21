import { authorizeUrlOf, codeChallengeOf, cookieValueOf, exchangeSignIn, fleetsOf, randomUrlSafe, redeemCode, revokeSignIn, SHARED_SIGN_IN_COOKIE, type Pagasae } from './pagasae';
import { sessionCookieOf } from './plugin-call';
import { serverInternalUrlFrom } from './server-url';

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

/** Where an account goes when it holds no scope in the fleet, or in any (accounts design, F1). */
export const NO_RIGHTS_PATH = '/sign-in/no-rights';
/** Where an account goes when pagasae does not answer. */
export const UNREACHABLE_PATH = '/sign-in/unreachable';

/** A path on this console to go back to, or the overview: never another site. */
export function returnPathOf(value: string | null): string {
  return value !== null && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/sign-in') ? value : '/';
}

function redirectTo(location: string, cookies: readonly string[] = []): Response {
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

function redirectUriOf(request: Request): string {
  return new URL('/sign-in/done', request.url).toString();
}

/** Starts the sign-in: to pagasae's sign-in with a fresh state and PKCE verifier, kept in a short cookie for the way back. */
export async function startSignIn(request: Request, pagasae: Pagasae): Promise<Response> {
  const state = randomUrlSafe();
  const verifier = randomUrlSafe();
  const returnTo = returnPathOf(new URL(request.url).searchParams.get('returnTo'));
  const flow = Buffer.from(JSON.stringify({ state, verifier, returnTo })).toString('base64url');
  const location = authorizeUrlOf(pagasae, {
    redirectUri: redirectUriOf(request),
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
  const { pagasae } = deps;
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
        redirectUri: redirectUriOf(request),
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
function fleetToEnter(fleets: readonly { id: string; hasConsole: boolean }[], chosen: string | undefined): string | undefined {
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
 * With the shared sign-in, into a fleet: an account token for it from
 * pagasae, kept by core in its token cookie, then on to the page asked for.
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
            consoleCookie(FLEET_COOKIE, {
              value: fleetId,
              maxAgeSeconds: FLEET_COOKIE_LIFE_SECONDS,
            }),
          ]);
    }
  }
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
        origin: new URL(request.url).origin,
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
