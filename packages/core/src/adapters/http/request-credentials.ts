/**
 * How a request says who it is: a crew token as a bearer token, or the console
 * session cookie. The ship secret travels only in the body of `register`.
 *
 * The console session cookie holds the random session token, never the ship secret.
 * httpOnly so scripts cannot read it, Secure so it only travels over HTTPS
 * (browsers accept it on http://localhost for development), SameSite=Strict so
 * no other site's page can make the browser send it.
 */
export const SESSION_COOKIE_NAME = 'aeolus_session';

const ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Strict';

/**
 * The cookie's scope: every host under the configured domain, so a console on
 * another host of that domain sends it too; otherwise the server's host only.
 */
function scope(domain: string | undefined): string {
  return domain === undefined ? ATTRIBUTES : `Domain=${domain}; ${ATTRIBUTES}`;
}

/** The session token from a Cookie request header, if there is one. */
export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  for (const pair of cookieHeader?.split(';') ?? []) {
    const separator = pair.indexOf('=');
    if (separator !== -1 && pair.slice(0, separator).trim() === SESSION_COOKIE_NAME) {
      const value = pair.slice(separator + 1).trim();
      return value === '' ? undefined : value;
    }
  }
  return undefined;
}

/** A Set-Cookie value that keeps the token until the session expires. */
export function sessionCookie(cookie: { token: string; expiresAt: Date; now: Date; domain?: string }): string {
  const { token, expiresAt, now, domain } = cookie;
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return `${SESSION_COOKIE_NAME}=${token}; Max-Age=${maxAgeSeconds}; ${scope(domain)}`;
}

/** A Set-Cookie value that removes the cookie, for the same domain it was set for. */
export function clearedSessionCookie(domain?: string): string {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; ${scope(domain)}`;
}

/** The token from an `Authorization: Bearer <token>` header, if there is one. */
export function readBearer(authorizationHeader: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorizationHeader ?? '');
  return match?.[1];
}
