/**
 * How a request says who it is: a ship secret as a bearer token, or the console
 * session cookie.
 *
 * The console session cookie holds the random session token, never the ship secret.
 * httpOnly so scripts cannot read it, Secure so it only travels over HTTPS
 * (browsers accept it on http://localhost for development), SameSite=Strict so
 * no other site's page can make the browser send it.
 */
export const SESSION_COOKIE_NAME = 'aeolus_session';

const ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Strict';

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
export function sessionCookie(cookie: { token: string; expiresAt: Date; now: Date }): string {
  const { token, expiresAt, now } = cookie;
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return `${SESSION_COOKIE_NAME}=${token}; Max-Age=${maxAgeSeconds}; ${ATTRIBUTES}`;
}

/** A Set-Cookie value that removes the cookie. */
export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; ${ATTRIBUTES}`;
}

/** The secret from an `Authorization: Bearer <secret>` header, if there is one. */
export function readBearer(authorizationHeader: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorizationHeader ?? '');
  return match?.[1];
}
