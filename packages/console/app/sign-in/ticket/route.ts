import { serverInternalUrlFrom } from '../../../lib/server-url';

// Every redeem is fresh: a ticket signs in once.
export const dynamic = 'force-dynamic';

/** The longest a redeem may take before the hand-off counts as failed. */
const REDEEM_TIMEOUT_MS = 10_000;

/** A redirect to a path on this console, with the session cookie the server set when there is one. */
function redirectTo(path: string, sessionCookie?: string): Response {
  const headers = new Headers({ location: path, 'cache-control': 'no-store' });
  if (sessionCookie !== undefined) {
    headers.append('set-cookie', sessionCookie);
  }
  return new Response(null, { status: 303, headers });
}

/**
 * The hosted hand-off (docs/blueprint.md, "Installation"): the hosting
 * service sends the operator's browser here with a one-time sign-in ticket.
 * The web app's server redeems it with the fleet server, which starts the
 * console session exactly as a password sign-in does, passes the session
 * cookie on and redirects into the console, so the ticket leaves the address
 * bar at once. A used, expired or unknown ticket goes to the failed hand-off.
 */
export async function GET(request: Request): Promise<Response> {
  const ticket = new URL(request.url).searchParams.get('ticket') ?? '';
  if (ticket === '') {
    return redirectTo('/sign-in/failed');
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const userAgent = request.headers.get('user-agent');
  if (userAgent !== null) {
    // The session is named for the operator's device, as after a password sign-in.
    headers['user-agent'] = userAgent;
  }
  try {
    const answer = await fetch(`${serverInternalUrlFrom(process.env)}/trpc/console.redeemSignInTicket`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ticket }),
      cache: 'no-store',
      signal: AbortSignal.timeout(REDEEM_TIMEOUT_MS),
    });
    const sessionCookie = answer.headers.get('set-cookie');
    return answer.ok && sessionCookie !== null ? redirectTo('/', sessionCookie) : redirectTo('/sign-in/failed');
  } catch {
    return redirectTo('/sign-in/failed');
  }
}
