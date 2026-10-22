import { argoSignInOutputSchema, type ArgoSignInOutput } from '@aeolus-fleet/common';
import { z } from 'zod';

import { FLEET_COOKIE, fleetToEnter, redirectTo, type SignInDeps } from './account-sign-in';
import { askPagasae } from './account-name';
import { ACCOUNT_TOKEN_COOKIE, SESSION_COOKIE } from './console-gate';
import { cookieValueOf, exchangeArgoTicket, exchangeSignIn, fleetsOf, SHARED_SIGN_IN_COOKIE, type Pagasae } from './pagasae';
import { consoleOriginOf } from './console-origin';
import { serverInternalUrlFrom } from './server-url';
import { UNREACHABLE_PATH } from './sign-in-paths';

/**
 * Break-glass (accounts design, F4, A7): an account allowed as argo of the
 * fleet signs in as argo from the console, on the web app's server. It asks
 * pagasae for core's one-time ticket naming the account, redeems it at core,
 * which takes argo's lease over and ends any other argo sign-in, and passes
 * argo's session cookie on. When someone else holds argo, it warns first.
 * Sign out of argo ends that session alone and enters the fleet again as the
 * account, with the shared sign-in that still holds.
 */

type Environment = Readonly<Record<string, string | undefined>>;

/** Where an account is told it may not sign in as argo of this fleet. */
export const ARGO_REFUSED_PATH = '/sign-in/argo/refused';
/** Where an account is warned that signing in as argo signs someone else out of argo. */
export const ARGO_CONFIRM_PATH = '/sign-in/argo/confirm';
/** The form field that says the account saw the warning and goes on. */
export const CONFIRMED_FIELD = 'confirmed';

const CORE_TIMEOUT_MS = 10_000;

/** Whether the request comes from a page of the console: a browser always sends Origin with a POST. */
function isFromConsole(request: Request, environment: Environment): boolean {
  return request.headers.get('origin') === consoleOriginOf(request, environment);
}

/** The fleet an account signs in as argo of: the one the console enters, when the account is allowed as argo there. */
async function argoFleetOf(pagasae: Pagasae, cookies: string | null): Promise<{ fleetId: string } | 'none' | 'ended' | 'unreachable'> {
  const signIn = cookieValueOf(cookies, SHARED_SIGN_IN_COOKIE);
  if (signIn === undefined) {
    return 'ended';
  }
  const fleets = await fleetsOf({ pagasae }, signIn);
  if (typeof fleets === 'string') {
    return fleets;
  }
  const fleetId = fleetToEnter(fleets, cookieValueOf(cookies, FLEET_COOKIE));
  return fleets.some((fleet) => fleet.id === fleetId && fleet.isArgoAllowed) && fleetId !== undefined ? { fleetId } : 'none';
}

/** Whether the shared sign-in's account may sign in as argo of the fleet the console enters: for the avatar menu and the sign-in page. */
export async function isArgoAllowed(pagasae: Pagasae, cookies: string | null): Promise<boolean> {
  return typeof (await argoFleetOf(pagasae, cookies)) === 'object';
}

/** The account's token for core: its token cookie, or a fresh one from pagasae for the shared sign-in once that cookie ended. */
async function accountTokenOf(cookies: string | null, deps: SignInDeps): Promise<string | undefined> {
  const token = cookieValueOf(cookies, ACCOUNT_TOKEN_COOKIE);
  if (token !== undefined) {
    return token;
  }
  const signIn = cookieValueOf(cookies, SHARED_SIGN_IN_COOKIE);
  const fleetId = cookieValueOf(cookies, FLEET_COOKIE);
  if (signIn === undefined || fleetId === undefined) {
    return undefined;
  }
  const exchanged = await exchangeSignIn({ pagasae: deps.pagasae }, { signIn, fleetId });
  return exchanged.kind === 'token' ? exchanged.token : undefined;
}

/** Who holds argo's sign-in, as core answers the account; undefined when that is unknown, as when core does not answer. */
async function argoSignInOf(cookies: string | null, deps: SignInDeps): Promise<ArgoSignInOutput | undefined> {
  const token = await accountTokenOf(cookies, deps);
  if (token === undefined) {
    return undefined;
  }
  try {
    const answer = await fetch(`${serverInternalUrlFrom(deps.environment)}/trpc/console.argoSignIn`, {
      headers: { cookie: `${ACCOUNT_TOKEN_COOKIE}=${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
    });
    return answer.ok ? z.object({ result: z.object({ data: argoSignInOutputSchema }) }).parse(await answer.json()).result.data : undefined;
  } catch {
    return undefined;
  }
}

/** Who signing in as argo signs out, for the warning: an account by the name pagasae gives it, or someone it cannot name; none when no one holds argo. */
export type ArgoHolder = { kind: 'none' } | { kind: 'account'; name: string } | { kind: 'unnamed' };

export async function argoHolderOf(cookies: string | null, deps: SignInDeps): Promise<ArgoHolder> {
  const held = await argoSignInOf(cookies, deps);
  // Warned only when someone holds argo: unknown warns of no one.
  if (held?.isSignedIn !== true) {
    return { kind: 'none' };
  }
  const fleetId = cookieValueOf(cookies, FLEET_COOKIE);
  if (held.accountId == null || fleetId === undefined) {
    return { kind: 'unnamed' };
  }
  const name = await askPagasae({ pagasae: deps.pagasae, fleetId, accountId: held.accountId, fetchImplementation: fetch });
  return { kind: 'account', name: name ?? held.accountId };
}

/** Redeems the ticket at core, which starts argo's console session as any ticket does; its session cookie, or none when core refuses or does not answer. */
async function redeemAtCore(redeem: { ticket: string; userAgent: string | null }, environment: Environment): Promise<string | undefined> {
  const { ticket, userAgent } = redeem;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (userAgent !== null) {
    // The session is named for the device, as after any sign-in.
    headers['user-agent'] = userAgent;
  }
  try {
    const answer = await fetch(`${serverInternalUrlFrom(environment)}/trpc/console.redeemSignInTicket`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ticket }),
      cache: 'no-store',
      signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
    });
    return answer.ok ? (answer.headers.get('set-cookie') ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Signs the account in as argo of the fleet the console enters: refused when
 * it may not, warned first when someone holds argo and it has not confirmed,
 * then pagasae's ticket redeemed at core and on into argo's console.
 */
export async function signInAsArgo(request: Request, deps: SignInDeps): Promise<Response> {
  if (!isFromConsole(request, deps.environment)) {
    return new Response(null, { status: 403 });
  }
  const cookies = request.headers.get('cookie');
  const startAgain = '/sign-in/start';
  const fleet = await argoFleetOf(deps.pagasae, cookies);
  if (fleet === 'ended') {
    return redirectTo(startAgain);
  }
  if (fleet === 'unreachable') {
    return redirectTo(UNREACHABLE_PATH);
  }
  if (fleet === 'none') {
    return redirectTo(ARGO_REFUSED_PATH);
  }
  const form = await request.formData().catch(() => new FormData());
  if (form.get(CONFIRMED_FIELD) !== 'yes' && (await argoSignInOf(cookies, deps))?.isSignedIn === true) {
    return redirectTo(ARGO_CONFIRM_PATH);
  }
  const signIn = cookieValueOf(cookies, SHARED_SIGN_IN_COOKIE) ?? '';
  const ticket = await exchangeArgoTicket({ pagasae: deps.pagasae }, { signIn, fleetId: fleet.fleetId });
  switch (ticket.kind) {
    case 'ended':
      return redirectTo(startAgain);
    case 'notAllowed':
      return redirectTo(ARGO_REFUSED_PATH);
    case 'unreachable':
      return redirectTo(UNREACHABLE_PATH);
    case 'ticket': {
      const sessionCookie = await redeemAtCore({ ticket: ticket.ticket, userAgent: request.headers.get('user-agent') }, deps.environment);
      return sessionCookie === undefined ? redirectTo('/sign-in/failed') : redirectTo('/', [sessionCookie]);
    }
  }
}

/**
 * Signs out of argo alone: core ends argo's session and clears its cookie.
 * The console's page asks it and then enters the fleet again as the account;
 * 503 says core did not answer, so argo's session stays and the page says so.
 */
export async function signOutOfArgo(request: Request, environment: Environment): Promise<Response> {
  if (!isFromConsole(request, environment)) {
    return new Response(null, { status: 403 });
  }
  const session = cookieValueOf(request.headers.get('cookie'), SESSION_COOKIE);
  if (session === undefined) {
    return new Response(null, { status: 204 });
  }
  try {
    const answer = await fetch(`${serverInternalUrlFrom(environment)}/trpc/console.signOut`, {
      method: 'POST',
      // argo's session cookie alone: the account's token cookie stays.
      headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${session}`, origin: consoleOriginOf(request, environment) },
      body: '{}',
      cache: 'no-store',
      signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
    });
    if (!answer.ok) {
      return new Response(null, { status: 503 });
    }
    const headers = new Headers();
    for (const cookie of answer.headers.getSetCookie()) {
      headers.append('set-cookie', cookie);
    }
    return new Response(null, { status: 204, headers });
  } catch {
    return new Response(null, { status: 503 });
  }
}
