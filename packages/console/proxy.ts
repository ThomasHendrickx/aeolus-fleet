import { NextResponse, type NextRequest } from 'next/server';

import { isTimeToRenew } from './lib/account-renewal-schedule';
import { renewAccountToken, type Renewal } from './lib/account-sign-in';
import { ACCOUNT_TOKEN_COOKIE, sessionOf, signInUrlFor } from './lib/console-gate';
import { cookieValueOf, pagasaeFrom, SHARED_SIGN_IN_COOKIE } from './lib/pagasae';
import { serverInternalUrlFrom } from './lib/server-url';
import { NO_RIGHTS_PATH, NOTHING_TO_MANAGE_PATH, signInEndedPathOf } from './lib/sign-in-paths';

/**
 * Signs in before the console renders: a console page asked for without a
 * live session redirects on the server, to the hosting service's sign-in or
 * the console's own (saying so when the operator signed in somewhere else),
 * so nothing of the console shows first. When the server
 * does not answer the check, the page renders and the console decides in the
 * browser, as before.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const renewal = await renewalOnLoad(request);
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (renewal?.kind === 'ended') {
    return NextResponse.redirect(new URL(signInEndedPathOf(returnTo), request.url));
  }
  if (renewal?.kind === 'noRights') {
    return NextResponse.redirect(new URL(NO_RIGHTS_PATH, request.url));
  }
  const headers = renewal?.kind === 'renewed' ? withCookies(request.headers, renewal.cookies) : request.headers;
  const session = await sessionOf(new Request(request.url, { headers }), { serverUrl: serverInternalUrlFrom(process.env) });
  const answer = answerFor(request, { session, hasSharedSignIn: cookieValueOf(headers.get('cookie'), SHARED_SIGN_IN_COOKIE) !== undefined, headers });
  for (const cookie of renewal?.kind === 'renewed' ? renewal.cookies : []) {
    answer.headers.append('set-cookie', cookie);
  }
  return answer;
}

function answerFor(request: NextRequest, { session, hasSharedSignIn, headers }: { session: Awaited<ReturnType<typeof sessionOf>>; hasSharedSignIn: boolean; headers: Headers }): NextResponse {
  if (session === 'nothingToManage') {
    return NextResponse.redirect(new URL(NOTHING_TO_MANAGE_PATH, request.url));
  }
  if (session === 'ended' || session === 'signedInElsewhere') {
    return NextResponse.redirect(signInUrlFor(process.env, { requestUrl: request.url, ended: session, hasSharedSignIn }));
  }
  return NextResponse.next({ request: { headers } });
}

/**
 * An account's token within two minutes of its end is renewed before the page
 * renders (accounts design, A3), so a page load never starts on a token about
 * to end. pagasae not answering leaves the page to render on the token it has.
 */
async function renewalOnLoad(request: NextRequest): Promise<Renewal | undefined> {
  const pagasae = pagasaeFrom(process.env);
  const token = cookieValueOf(request.headers.get('cookie'), ACCOUNT_TOKEN_COOKIE);
  if (pagasae === undefined || token === undefined || !isTimeToRenew(token, new Date())) {
    return undefined;
  }
  const renewal = await renewAccountToken(request, { pagasae, environment: process.env });
  return renewal.kind === 'unreachable' ? undefined : renewal;
}

/** The request's headers with the cookies the renewal set in place of the old, so the page renders with the fresh token. */
function withCookies(headers: Headers, setCookies: readonly string[]): Headers {
  const fresh = new Map(setCookies.map((setCookie) => setCookie.split(';')[0] ?? '').map((pair) => [pair.slice(0, pair.indexOf('=')), pair] as const));
  const kept = (headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !fresh.has(part.slice(0, part.indexOf('='))));
  const renewed = new Headers(headers);
  renewed.set('cookie', [...kept, ...fresh.values()].join('; '));
  return renewed;
}

export const config = {
  // Every console page; not sign-in, the web app's own API, health and version, /.well-known (OAuth discovery answers 404: the fleet has no OAuth), or Next's and the app's static files.
  matcher: ['/((?!sign-in|api|health|version|\\.well-known|_next|icon\\.svg|favicon\\.ico|.*\\.(?:woff2?|png|svg|ico)$).*)'],
};
