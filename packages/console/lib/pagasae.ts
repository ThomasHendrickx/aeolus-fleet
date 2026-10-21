import { z } from 'zod';

/**
 * pagasae as the console's server reaches it (decision 0054; header design,
 * H5): the account app every Aeolus app signs its humans in through. The
 * console is its OpenID Connect client `console`, with a client secret, and
 * gets an account token for the fleet in view with the shared sign-in, the
 * cookie pagasae sets on the shared domain (accounts design, A3). Read by the
 * web app's server only (decision 0033); the browser never sees the secret or
 * a token.
 */

type Environment = Readonly<Record<string, string | undefined>>;

export interface Pagasae {
  /** Its address, with no trailing slash. */
  url: string;
  clientId: string;
  clientSecret: string;
}

/** The shared sign-in: pagasae's cookie on the shared domain, which every app's server forwards to it, never reads. */
export const SHARED_SIGN_IN_COOKIE = 'aeolus_account_session';

/** How long the console's server waits for pagasae. */
const PAGASAE_TIMEOUT_MS = 10_000;

/** pagasae from AEOLUS_PAGASAE_URL, AEOLUS_PAGASAE_CLIENT_ID and AEOLUS_PAGASAE_CLIENT_SECRET; none unless all three are set. */
export function pagasaeFrom(environment: Environment): Pagasae | undefined {
  const { AEOLUS_PAGASAE_URL: url, AEOLUS_PAGASAE_CLIENT_ID: clientId, AEOLUS_PAGASAE_CLIENT_SECRET: clientSecret } = environment;
  if (url === undefined || url === '' || clientId === undefined || clientId === '' || clientSecret === undefined || clientSecret === '') {
    return undefined;
  }
  return { url: url.replace(/\/+$/, ''), clientId, clientSecret };
}

/** HTTP Basic client authentication with the console's client id and secret. */
export function basicAuthOf(pagasae: Pagasae): string {
  return `Basic ${Buffer.from(`${pagasae.clientId}:${pagasae.clientSecret}`).toString('base64')}`;
}

/** Where the browser goes to sign in: pagasae's authorize endpoint, with PKCE (S256). */
export function authorizeUrlOf(pagasae: Pagasae, request: { redirectUri: string; state: string; codeChallenge: string }): string {
  const url = new URL(`${pagasae.url}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: pagasae.clientId,
    redirect_uri: request.redirectUri,
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

/** A random PKCE code verifier, and a state, in base64url. */
export function randomUrlSafe(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

/** The S256 code challenge of a verifier. */
export async function codeChallengeOf(verifier: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
}

/** pagasae, and the fetch that reaches it (another in tests). */
export interface PagasaeAt {
  pagasae: Pagasae;
  fetchImplementation?: typeof fetch;
}

function post({ pagasae, fetchImplementation = fetch }: PagasaeAt, request: { path: string; form: Record<string, string> }): Promise<Response> {
  const { path, form } = request;
  return fetchImplementation(`${pagasae.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...form,
      client_id: pagasae.clientId,
      client_secret: pagasae.clientSecret,
    }).toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(PAGASAE_TIMEOUT_MS),
  });
}

/** Redeems the code pagasae gave back with the browser: true when pagasae takes it, so the shared sign-in holds. */
export async function redeemCode(at: PagasaeAt, code: { code: string; redirectUri: string; codeVerifier: string }): Promise<boolean> {
  try {
    const response = await post(at, {
      path: '/oauth/token',
      form: {
        grant_type: 'authorization_code',
        code: code.code,
        redirect_uri: code.redirectUri,
        code_verifier: code.codeVerifier,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * An account token for one fleet, from the shared sign-in (RFC 8693 token
 * exchange): the token and how long it lasts; ended when the sign-in ended
 * (signed out, disabled, or unused for 30 days); no rights when the account
 * holds no scope in that fleet; unreachable when pagasae does not answer.
 */
export type ExchangedToken = { kind: 'token'; token: string; expiresInSeconds: number } | { kind: 'ended' } | { kind: 'noRights' } | { kind: 'unreachable' };

const tokenAnswerSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});
const errorAnswerSchema = z.object({ error: z.string() });

/** A token exchange of the shared sign-in for the fleet (RFC 8693): pagasae's status and body, parsed or not. */
async function exchange(at: PagasaeAt, exchange: { signIn: string; fleetId: string; requestedTokenType?: string }): Promise<{ isOk: boolean; body: unknown }> {
  const response = await post(at, {
    path: '/oauth/token',
    form: {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: exchange.signIn,
      subject_token_type: 'urn:aeolus:params:oauth:token-type:sign-in',
      resource: exchange.fleetId,
      ...(exchange.requestedTokenType === undefined ? {} : { requested_token_type: exchange.requestedTokenType }),
    },
  });
  return { isOk: response.ok, body: await response.json().catch(() => undefined) };
}

/** The OAuth error pagasae answered, if it named one. */
function errorOf(body: unknown): string | undefined {
  return errorAnswerSchema.safeParse(body).data?.error;
}

export async function exchangeSignIn(at: PagasaeAt, signIn: { signIn: string; fleetId: string }): Promise<ExchangedToken> {
  try {
    const { isOk, body } = await exchange(at, signIn);
    if (isOk) {
      const answer = tokenAnswerSchema.safeParse(body);
      return answer.success
        ? {
            kind: 'token',
            token: answer.data.access_token,
            expiresInSeconds: answer.data.expires_in,
          }
        : { kind: 'unreachable' };
    }
    const error = errorOf(body);
    if (error === 'invalid_grant') {
      return { kind: 'ended' };
    }
    return error === 'invalid_target' ? { kind: 'noRights' } : { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}

/** The token type of core's one-time ticket that signs an account in as argo of a fleet (accounts design, F4). */
const ARGO_TICKET_TOKEN_TYPE = 'urn:aeolus:params:oauth:token-type:argo-sign-in-ticket';

/**
 * Core's ticket to sign in as argo of a fleet, from the shared sign-in
 * (accounts design, F4): one use, for 2 minutes; ended when the sign-in
 * ended; not allowed when the account may not sign in as argo there;
 * unreachable when pagasae does not answer.
 */
export type ExchangedArgoTicket = { kind: 'ticket'; ticket: string } | { kind: 'ended' } | { kind: 'notAllowed' } | { kind: 'unreachable' };

const ticketAnswerSchema = z.object({ access_token: z.string().min(1) });

export async function exchangeArgoTicket(at: PagasaeAt, signIn: { signIn: string; fleetId: string }): Promise<ExchangedArgoTicket> {
  try {
    const { isOk, body } = await exchange(at, { ...signIn, requestedTokenType: ARGO_TICKET_TOKEN_TYPE });
    if (isOk) {
      const answer = ticketAnswerSchema.safeParse(body);
      return answer.success ? { kind: 'ticket', ticket: answer.data.access_token } : { kind: 'unreachable' };
    }
    const error = errorOf(body);
    if (error === 'invalid_grant') {
      return { kind: 'ended' };
    }
    return error === 'invalid_target' ? { kind: 'notAllowed' } : { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}

/** A fleet the account holds a scope in, as pagasae lists it: whether it opens the console there (it holds fleet:read), and whether it may sign in as argo there. */
export interface AccountFleet {
  id: string;
  name: string;
  hasConsole: boolean;
  isArgoAllowed: boolean;
}

const appsAnswerSchema = z.object({
  fleets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      argo: z.boolean(),
      apps: z.array(z.object({ app: z.string() })),
    }),
  ),
});

/** The fleets the shared sign-in's account has rights in (GET /api/apps); ended when the sign-in ended; unreachable when pagasae does not answer. */
export async function fleetsOf({ pagasae, fetchImplementation = fetch }: PagasaeAt, signIn: string): Promise<AccountFleet[] | 'ended' | 'unreachable'> {
  try {
    const response = await fetchImplementation(`${pagasae.url}/api/apps`, {
      headers: {
        authorization: basicAuthOf(pagasae),
        'aeolus-sign-in': signIn,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(PAGASAE_TIMEOUT_MS),
    });
    if (response.status === 401) {
      return 'ended';
    }
    const answer = appsAnswerSchema.safeParse(await response.json().catch(() => undefined));
    if (!response.ok || !answer.success) {
      return 'unreachable';
    }
    return answer.data.fleets.map(({ id, name, argo, apps }) => ({
      id,
      name,
      hasConsole: apps.some(({ app }) => app === 'console'),
      isArgoAllowed: argo,
    }));
  } catch {
    return 'unreachable';
  }
}

/** Ends the shared sign-in at pagasae, everywhere (RFC 7009); true when pagasae took it. */
export async function revokeSignIn(at: PagasaeAt, signIn: string): Promise<boolean> {
  try {
    return (await post(at, { path: '/oauth/revoke', form: { token: signIn } })).ok;
  } catch {
    return false;
  }
}

/** The value of one cookie in a Cookie request header, if it holds one. */
export function cookieValueOf(cookieHeader: string | null, name: string): string | undefined {
  for (const part of (cookieHeader ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value === '' ? undefined : value;
    }
  }
  return undefined;
}
