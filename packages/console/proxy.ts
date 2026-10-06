import { NextResponse, type NextRequest } from 'next/server';

import { hasLiveSession, SESSION_COOKIE, signInUrlFor } from './lib/console-gate';
import { serverInternalUrlFrom } from './lib/server-url';

/**
 * Signs in before the console renders: a console page asked for without a
 * live session redirects on the server, to the hosting service's sign-in or
 * the console's own, so nothing of the console shows first. When the server
 * does not answer the check, the page renders and the console decides in the
 * browser, as before.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const cookie = request.cookies.get(SESSION_COOKIE);
  const isLive = cookie === undefined ? false : await hasLiveSession({ serverUrl: serverInternalUrlFrom(process.env), cookie: request.headers.get('cookie') ?? '' });
  return isLive === false ? NextResponse.redirect(signInUrlFor(process.env, request.url)) : NextResponse.next();
}

export const config = {
  // Every console page; not sign-in, the web app's own API, health and version, or Next's and the app's static files.
  matcher: ['/((?!sign-in|api|health|version|_next|icon\\.svg|favicon\\.ico|.*\\.(?:woff2?|png|svg|ico)$).*)'],
};
