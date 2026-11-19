import { z } from 'zod';

/**
 * the account app as the console's server reaches it (decision 0054; header design,
 * H5): the account app every Aeolus app signs its humans in through. The
 * console is its OpenID Connect client `console`, with a client secret, and
 * gets an account token for the fleet in view with the shared sign-in, the
 * cookie the account app sets on the shared domain (accounts design, A3). Read by the
 * web app's server only (decision 0033); the browser never sees the secret or
 * a token.
 */

type Environment = Readonly<Record<string, string | undefined>>;

export interface AccountApp {
  /** Its address, with no trailing slash. */
  url: string;
  clientId: string;
  clientSecret: string;
}

/** The shared sign-in: the account app's cookie on the shared domain, which every app's server forwards to it, never reads. */
export const SHARED_SIGN_IN_COOKIE = 'aeolus_account_session';

/** How long the console's server waits for the account app. */
const ACCOUNT_APP_TIMEOUT_MS = 10_000;

/** the account app from AEOLUS_ACCOUNT_APP_URL, AEOLUS_ACCOUNT_APP_CLIENT_ID and AEOLUS_ACCOUNT_APP_CLIENT_SECRET; none unless all three are set. */
export function accountAppFrom(environment: Environment): AccountApp | undefined {
  const { AEOLUS_ACCOUNT_APP_URL: url, AEOLUS_ACCOUNT_APP_CLIENT_ID: clientId, AEOLUS_ACCOUNT_APP_CLIENT_SECRET: clientSecret } = environment;
  if (url === undefined || url === '' || clientId === undefined || clientId === '' || clientSecret === undefined || clientSecret === '') {
    return undefined;
  }
  return { url: url.replace(/\/+$/, ''), clientId, clientSecret };
}

/** HTTP Basic client authentication with the console's client id and secret. */
export function basicAuthOf(accountApp: AccountApp): string {
  return `Basic ${Buffer.from(`${accountApp.clientId}:${accountApp.clientSecret}`).toString('base64')}`;
}

/** Where the browser goes to sign in: the account app's authorize endpoint, with PKCE (S256). */
export function authorizeUrlOf(accountApp: AccountApp, request: { redirectUri: string; state: string; codeChallenge: string }): string {
  const url = new URL(`${accountApp.url}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: accountApp.clientId,
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

/** the account app, and the fetch that reaches it (another in tests). */
export interface AccountAppAt {
  accountApp: AccountApp;
  fetchImplementation?: typeof fetch;
}

/** Which call of the console's server to the account app. */
type AccountAppCall = 'token exchange' | 'argo ticket exchange' | 'apps list';

/**
 * Logs on the server why a call maps to unreachable, so the next occurrence
 * names its cause. The reason holds a status, an error name or a cause code,
 * never a token, a secret or a body.
 */
function logUnreachable(call: AccountAppCall, reason: string): void {
  console.warn(`the account app unreachable: ${call}: ${reason}`);
}

/** The code of a network error's cause, such as ECONNRESET. */
function codeOf(cause: unknown): string | undefined {
  return z.object({ code: z.string() }).safeParse(cause).data?.code;
}

/** Why a call to the account app threw: a timeout, or a network error with its name and cause code. */
function thrownReasonOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'network error';
  }
  if (error.name === 'TimeoutError') {
    return `timeout after ${ACCOUNT_APP_TIMEOUT_MS} ms`;
  }
  const code = codeOf(error.cause);
  return `network error ${error.name}${code === undefined ? '' : ` ${code}`}`;
}

function post({ accountApp, fetchImplementation = fetch }: AccountAppAt, request: { path: string; form: Record<string, string> }): Promise<Response> {
  const { path, form } = request;
  return fetchImplementation(`${accountApp.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...form,
      client_id: accountApp.clientId,
      client_secret: accountApp.clientSecret,
    }).toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(ACCOUNT_APP_TIMEOUT_MS),
  });
}

/** Redeems the code the account app gave back with the browser: true when the account app takes it, so the shared sign-in holds. */
export async function redeemCode(at: AccountAppAt, code: { code: string; redirectUri: string; codeVerifier: string }): Promise<boolean> {
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
 * holds no scope in that fleet; unreachable when the account app does not answer.
 */
export type ExchangedToken = { kind: 'token'; token: string; expiresInSeconds: number } | { kind: 'ended' } | { kind: 'noRights' } | { kind: 'unreachable' };

const tokenAnswerSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});
const errorAnswerSchema = z.object({ error: z.string() });

/** A token exchange of the shared sign-in for the fleet (RFC 8693): the account app's status and body, parsed or not. */
async function exchange(at: AccountAppAt, exchange: { signIn: string; fleetId: string; requestedTokenType?: string }): Promise<{ isOk: boolean; status: number; body: unknown }> {
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
  return { isOk: response.ok, status: response.status, body: await response.json().catch(() => undefined) };
}

/** Why an exchange answer maps to unreachable: its status, and the OAuth error it named or why it had none. */
function exchangeReasonOf(answer: { isOk: boolean; status: number; body: unknown }): string {
  if (answer.body === undefined) {
    return `status ${answer.status}, unparseable body`;
  }
  if (answer.isOk) {
    return `status ${answer.status}, answer without the expected fields`;
  }
  const error = errorOf(answer.body);
  return error === undefined ? `status ${answer.status}, answer without an error` : `status ${answer.status}, error ${error}`;
}

/** The OAuth error the account app answered, if it named one. */
function errorOf(body: unknown): string | undefined {
  return errorAnswerSchema.safeParse(body).data?.error;
}

export async function exchangeSignIn(at: AccountAppAt, signIn: { signIn: string; fleetId: string }): Promise<ExchangedToken> {
  try {
    const answered = await exchange(at, signIn);
    if (answered.isOk) {
      const answer = tokenAnswerSchema.safeParse(answered.body);
      if (answer.success) {
        return {
          kind: 'token',
          token: answer.data.access_token,
          expiresInSeconds: answer.data.expires_in,
        };
      }
    } else {
      const error = errorOf(answered.body);
      if (error === 'invalid_grant') {
        return { kind: 'ended' };
      }
      if (error === 'invalid_target') {
        return { kind: 'noRights' };
      }
    }
    logUnreachable('token exchange', exchangeReasonOf(answered));
    return { kind: 'unreachable' };
  } catch (error) {
    logUnreachable('token exchange', thrownReasonOf(error));
    return { kind: 'unreachable' };
  }
}

/** The token type of core's one-time ticket that signs an account in as argo of a fleet (accounts design, F4). */
const ARGO_TICKET_TOKEN_TYPE = 'urn:aeolus:params:oauth:token-type:argo-sign-in-ticket';

/**
 * Core's ticket to sign in as argo of a fleet, from the shared sign-in
 * (accounts design, F4): one use, for 2 minutes; ended when the sign-in
 * ended; not allowed when the account may not sign in as argo there;
 * unreachable when the account app does not answer.
 */
export type ExchangedArgoTicket = { kind: 'ticket'; ticket: string } | { kind: 'ended' } | { kind: 'notAllowed' } | { kind: 'unreachable' };

const ticketAnswerSchema = z.object({ access_token: z.string().min(1) });

export async function exchangeArgoTicket(at: AccountAppAt, signIn: { signIn: string; fleetId: string }): Promise<ExchangedArgoTicket> {
  try {
    const answered = await exchange(at, { ...signIn, requestedTokenType: ARGO_TICKET_TOKEN_TYPE });
    if (answered.isOk) {
      const answer = ticketAnswerSchema.safeParse(answered.body);
      if (answer.success) {
        return { kind: 'ticket', ticket: answer.data.access_token };
      }
    } else {
      const error = errorOf(answered.body);
      if (error === 'invalid_grant') {
        return { kind: 'ended' };
      }
      if (error === 'invalid_target') {
        return { kind: 'notAllowed' };
      }
    }
    logUnreachable('argo ticket exchange', exchangeReasonOf(answered));
    return { kind: 'unreachable' };
  } catch (error) {
    logUnreachable('argo ticket exchange', thrownReasonOf(error));
    return { kind: 'unreachable' };
  }
}

/** A fleet the account holds a scope in, as the account app lists it: whether it opens the console there (it holds fleet:read), and whether it may sign in as argo there. */
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

/** The fleets the shared sign-in's account has rights in (GET /api/apps); ended when the sign-in ended; unreachable when the account app does not answer. */
export async function fleetsOf({ accountApp, fetchImplementation = fetch }: AccountAppAt, signIn: string): Promise<AccountFleet[] | 'ended' | 'unreachable'> {
  try {
    const response = await fetchImplementation(`${accountApp.url}/api/apps`, {
      headers: {
        authorization: basicAuthOf(accountApp),
        'aeolus-sign-in': signIn,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(ACCOUNT_APP_TIMEOUT_MS),
    });
    if (response.status === 401) {
      return 'ended';
    }
    const body: unknown = await response.json().catch(() => undefined);
    const answer = appsAnswerSchema.safeParse(body);
    if (!response.ok || !answer.success) {
      logUnreachable('apps list', exchangeReasonOf({ isOk: response.ok, status: response.status, body }));
      return 'unreachable';
    }
    return answer.data.fleets.map(({ id, name, argo, apps }) => ({
      id,
      name,
      hasConsole: apps.some(({ app }) => app === 'console'),
      isArgoAllowed: argo,
    }));
  } catch (error) {
    logUnreachable('apps list', thrownReasonOf(error));
    return 'unreachable';
  }
}

/** Ends the shared sign-in at the account app, everywhere (RFC 7009); true when the account app took it. */
export async function revokeSignIn(at: AccountAppAt, signIn: string): Promise<boolean> {
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
