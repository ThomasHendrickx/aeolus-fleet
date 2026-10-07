/**
 * What a plugin's proxy (app/api/squadrons/[procedure],
 * app/api/trierarch-plugin/[procedure]) lets through. It forwards the
 * operator's console session, so a mutation must come from the console
 * itself: a page on a sibling host shares the site, and SameSite does not
 * stop it from posting a form with the cookie.
 */

/** The console session cookie the fleet sets: the only cookie a plugin needs. */
const SESSION_COOKIE_NAME = 'aeolus_session';

/**
 * Why a mutation is refused, or undefined when it may pass: it must come from
 * the console's own origin (Sec-Fetch-Site same-origin, or without that header
 * an Origin equal to the console's) and carry JSON, which a plain form cannot.
 */
export function mutationRefusal(request: Request, plugin: string): string | undefined {
  const fetchSite = request.headers.get('sec-fetch-site');
  const isSameOrigin = fetchSite === null ? request.headers.get('origin') === new URL(request.url).origin : fetchSite === 'same-origin';
  if (!isSameOrigin) {
    return `${plugin.charAt(0).toUpperCase()}${plugin.slice(1)} changes come only from the console`;
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    return `A ${plugin} change is sent as JSON`;
  }
  return undefined;
}

/** The request's cookie header down to the console session cookie, or empty without one. */
export function sessionCookieOf(cookieHeader: string | null): string {
  const session = (cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  return session ?? '';
}
