/**
 * How a request says who it is: a crew token as a bearer token, or the console
 * session cookie, and for a plugin's read, the ship it reads on behalf of; an
 * account token pagasae signed, or the installation token with the fleet it
 * acts in (decision 0057). The ship secret travels only in the body of
 * `register`.
 *
 * The console session cookie holds the random session token, never the ship secret.
 * httpOnly so scripts cannot read it, Secure so it only travels over HTTPS
 * (browsers accept it on http://localhost for development), SameSite=Strict so
 * no other site's page can make the browser send it.
 */
import { ACCOUNT_TOKEN_HEADER, FLEET_HEADER, ON_BEHALF_OF_HEADER } from '@aeolus-fleet/common';

export const SESSION_COOKIE_NAME = 'aeolus_session';

const ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Strict';

/**
 * The cookie's scope: every host under the configured domain, so a console on
 * another host of that domain sends it too; otherwise the server's host only.
 */
function scope(domain: string | undefined): string {
  return domain === undefined ? ATTRIBUTES : `Domain=${domain}; ${ATTRIBUTES}`;
}

/** The value of the named cookie in a Cookie request header, if it holds one. */
function cookieOf(cookieHeader: string | undefined, name: string): string | undefined {
  for (const pair of cookieHeader?.split(';') ?? []) {
    const separator = pair.indexOf('=');
    if (separator !== -1 && pair.slice(0, separator).trim() === name) {
      const value = pair.slice(separator + 1).trim();
      return value === '' ? undefined : value;
    }
  }
  return undefined;
}

/** The session token from a Cookie request header, if there is one. */
export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  return cookieOf(cookieHeader, SESSION_COOKIE_NAME);
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

/**
 * The cookie of an account's console sign-in: the account token pagasae
 * signed (decision 0058), which core checks on every call as it does the
 * header. Core sets it when the console's server presents the token, with
 * the session cookie's attributes, for as long as the token lasts.
 */
export const ACCOUNT_TOKEN_COOKIE_NAME = 'aeolus_account_token';

/** The account token from a Cookie request header, if there is one. */
export function readAccountTokenCookie(cookieHeader: string | undefined): string | undefined {
  return cookieOf(cookieHeader, ACCOUNT_TOKEN_COOKIE_NAME);
}

/** A Set-Cookie value that keeps the account token until it ends. */
export function accountTokenCookie(cookie: { token: string; endsAt: Date; now: Date; domain?: string }): string {
  const { token, endsAt, now, domain } = cookie;
  const maxAgeSeconds = Math.max(0, Math.floor((endsAt.getTime() - now.getTime()) / 1000));
  return `${ACCOUNT_TOKEN_COOKIE_NAME}=${token}; Max-Age=${maxAgeSeconds}; ${scope(domain)}`;
}

/** A Set-Cookie value that removes the account token's cookie, for the same domain it was set for. */
export function clearedAccountTokenCookie(domain?: string): string {
  return `${ACCOUNT_TOKEN_COOKIE_NAME}=; Max-Age=0; ${scope(domain)}`;
}

type Headers = Readonly<Record<string, string | string[] | undefined>>;

function readHeader(headers: Headers, name: string): string | undefined {
  const header = headers[name];
  return Array.isArray(header) ? header.join(',') : header;
}

/** The ship a plugin reads on behalf of, from the `Aeolus-On-Behalf-Of` header, if there is one (decision 0034). */
export function readOnBehalfOf(headers: Headers): string | undefined {
  return readHeader(headers, ON_BEHALF_OF_HEADER);
}

/** The account token from the `Aeolus-Account-Token` header, if there is one (decision 0058). */
export function readAccountToken(headers: Headers): string | undefined {
  return readHeader(headers, ACCOUNT_TOKEN_HEADER);
}

/** The fleet the installation acts in, from the `Aeolus-Fleet` header, if there is one (decision 0057). */
export function readFleet(headers: Headers): string | undefined {
  return readHeader(headers, FLEET_HEADER);
}

/** The token from an `Authorization: Bearer <token>` header, if there is one. */
export function readBearer(authorizationHeader: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorizationHeader ?? '');
  return match?.[1];
}
