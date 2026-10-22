import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { createTestIssuer, type TestIssuer } from '../../packages/core/src/testing/account-token-issuer.js';

/**
 * pagasae as the console meets it in the end-to-end tests: the shared sign-in
 * cookie, the console as an OpenID Connect client with PKCE, the token
 * exchange that answers an account token core trusts, the apps list, the
 * account-name lookup and revoke, with the answers pagasae gives (its
 * `lib/app-tokens.ts`, `app/api/apps`, `app/oauth/revoke`). Its sign-in page
 * signs in whoever the test says, at once. Given argo's tickets, it answers
 * an account allowed as argo of a fleet core's ticket for it (accounts
 * design, F4), as pagasae asks core for one.
 */

export interface FakeAccount {
  id: string;
  email: string;
  /** The fleets the account holds scopes in, with them, in the order pagasae lists them. */
  fleets: readonly { id: string; name: string; scopes: readonly string[]; isArgoAllowed?: boolean }[];
}

/** Core's sign-in ticket as argo of the fleet, naming the account, as pagasae gets it with the installation token. */
export type ArgoTickets = (fleetId: string, accountId: string) => Promise<string>;

const ARGO_TICKET_TOKEN_TYPE = 'urn:aeolus:params:oauth:token-type:argo-sign-in-ticket';

export interface FakePagasae {
  url: string;
  issuer: TestIssuer;
  clientId: string;
  clientSecret: string;
  /** The account the sign-in page signs in from now on. */
  signInAs(account: FakeAccount): void;
  /** How many times a browser came to the sign-in. */
  signInsAsked(): number;
  /** The shared sign-ins revoked so far. */
  revoked(): readonly string[];
  /** How long each account token lasts from now on, in seconds: 600 as pagasae's, or shorter to see a renewal soon. */
  issueTokensFor(seconds: number): void;
  /** The scopes the account holds in the fleet from now on, as an organisation admin changing its groups would give. */
  changeScopes(change: { accountId: string; fleetId: string; scopes: readonly string[] }): void;
  /** Every shared sign-in ends, as signing out elsewhere or disabling the account does. */
  endSignIns(): void;
  /** pagasae stops answering, or answers again. */
  setDown(isDown: boolean): void;
  /** How many account tokens it issued. */
  tokensIssued(): number;
  /** How many times an app's server asked for the apps list (GET /api/apps). */
  appsListsAsked(): number;
  close(): Promise<void>;
}

const CLIENT_ID = 'console';
const CLIENT_SECRET = 'e2e-console-secret-0123456789abcdef';
const COOKIE = 'aeolus_account_session';

function read(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      resolve(body);
    });
  });
}

function json(response: ServerResponse, answer: { status: number; body: unknown }): void {
  response.writeHead(answer.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(answer.body));
}

export async function startFakePagasae(options: { argoTickets?: ArgoTickets } = {}): Promise<FakePagasae> {
  let account: FakeAccount | undefined;
  let asked = 0;
  let tokenSeconds = 600;
  let isDown = false;
  let issued = 0;
  let appsListsAsked = 0;
  const sessions = new Map<string, FakeAccount>();
  const codes = new Map<string, { session: string; challenge: string; redirectUri: string }>();
  const revoked: string[] = [];
  // Known once the server listens: its address is the issuer's.
  const keys: { issuer?: TestIssuer } = {};

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://pagasae');
      if (isDown && url.pathname !== '/.well-known/jwks.json') {
        request.socket.destroy();
        return;
      }
      const { issuer } = keys;
      if (issuer === undefined) {
        json(response, { status: 503, body: {} });
        return;
      }
      if (url.pathname === '/.well-known/jwks.json') {
        json(response, { status: 200, body: issuer.keySet() });
        return;
      }
      if (url.pathname === '/oauth/authorize') {
        asked += 1;
        const params = url.searchParams;
        if (params.get('client_id') !== CLIENT_ID || params.get('code_challenge_method') !== 'S256' || account === undefined) {
          json(response, { status: 400, body: { error: 'invalid_request' } });
          return;
        }
        const session = randomUUID();
        sessions.set(session, account);
        const code = randomUUID();
        codes.set(code, { session, challenge: params.get('code_challenge') ?? '', redirectUri: params.get('redirect_uri') ?? '' });
        const back = new URL(params.get('redirect_uri') ?? '');
        back.search = new URLSearchParams({ code, state: params.get('state') ?? '' }).toString();
        // Host-only on localhost, as pagasae's is without SIGN_IN_COOKIE_DOMAIN: every app on localhost gets it.
        response.writeHead(302, { location: back.toString(), 'set-cookie': `${COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax` });
        response.end();
        return;
      }
      const form = new URLSearchParams(request.method === 'POST' ? await read(request) : '');
      const isClient = (form.get('client_id') === CLIENT_ID && form.get('client_secret') === CLIENT_SECRET) || request.headers.authorization === `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
      if (!isClient) {
        json(response, { status: 401, body: { error: 'invalid_client' } });
        return;
      }
      if (url.pathname === '/oauth/token' && form.get('grant_type') === 'authorization_code') {
        const held = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
        if (held?.challenge !== challenge || held.redirectUri !== form.get('redirect_uri')) {
          json(response, { status: 400, body: { error: 'invalid_grant' } });
          return;
        }
        json(response, { status: 200, body: { id_token: 'id-token', token_type: 'Bearer', expires_in: 600 } });
        return;
      }
      if (url.pathname === '/oauth/token') {
        const holder = sessions.get(form.get('subject_token') ?? '');
        if (holder === undefined) {
          json(response, { status: 400, body: { error: 'invalid_grant' } });
          return;
        }
        const fleet = holder.fleets.find(({ id }) => id === form.get('resource'));
        if (form.get('requested_token_type') === ARGO_TICKET_TOKEN_TYPE) {
          if (fleet?.isArgoAllowed !== true || options.argoTickets === undefined) {
            json(response, { status: 400, body: { error: 'invalid_target' } });
            return;
          }
          const ticket = await options.argoTickets(fleet.id, holder.id);
          json(response, { status: 200, body: { access_token: ticket, issued_token_type: ARGO_TICKET_TOKEN_TYPE, token_type: 'N_A', expires_in: 120 } });
          return;
        }
        if (fleet === undefined || fleet.scopes.length === 0) {
          json(response, { status: 400, body: { error: 'invalid_target' } });
          return;
        }
        const now = Math.floor(Date.now() / 1000);
        const token = issuer.sign({ iss: issuer.issuer, aud: fleet.id, sub: holder.id, org: 'org-acme', scope: fleet.scopes.join(' '), group: [], ...(fleet.isArgoAllowed === true ? { argo: true } : {}), iat: now, exp: now + tokenSeconds, jti: randomUUID() }, { type: 'at+jwt' });
        issued += 1;
        json(response, { status: 200, body: { access_token: token, issued_token_type: 'urn:ietf:params:oauth:token-type:jwt', token_type: 'Bearer', expires_in: tokenSeconds } });
        return;
      }
      if (url.pathname === '/api/apps') {
        appsListsAsked += 1;
        const holder = sessions.get(String(request.headers['aeolus-sign-in']));
        if (holder === undefined) {
          json(response, { status: 401, body: { error: 'invalid_grant' } });
          return;
        }
        json(response, {
          status: 200,
          body: {
            account: { id: holder.id, email: holder.email },
            apps: [],
            fleets: holder.fleets.map(({ id, name, scopes, isArgoAllowed }) => ({ id, name, argo: isArgoAllowed === true, apps: scopes.includes('fleet:read') ? [{ app: 'console', url: 'https://console.acme.example' }] : [] })),
          },
        });
        return;
      }
      if (url.pathname === '/api/console/account-name') {
        const named = [...sessions.values()].find(({ id }) => id === url.searchParams.get('accountId'));
        json(response, { status: named === undefined ? 404 : 200, body: named === undefined ? { error: 'not_found' } : { name: named.email } });
        return;
      }
      if (url.pathname === '/oauth/revoke') {
        const token = form.get('token') ?? '';
        sessions.delete(token);
        revoked.push(token);
        response.writeHead(200);
        response.end();
        return;
      }
      json(response, { status: 404, body: { error: 'not_found' } });
    })();
  });
  // Every address, so localhost reaches it whether it resolves to IPv4 or IPv6.
  await new Promise<void>((listening) => server.listen(0, listening));
  const bound = server.address();
  if (bound === null || typeof bound === 'string') {
    throw new Error('the fake pagasae listens on no port');
  }
  const url = `http://localhost:${String(bound.port)}`;
  const issuer = createTestIssuer(url);
  keys.issuer = issuer;
  return {
    url,
    issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    signInAs: (next) => {
      account = next;
    },
    signInsAsked: () => asked,
    revoked: () => revoked,
    issueTokensFor: (seconds) => {
      tokenSeconds = seconds;
    },
    changeScopes: ({ accountId, fleetId, scopes }) => {
      for (const [session, holder] of sessions) {
        if (holder.id === accountId) {
          sessions.set(session, { ...holder, fleets: holder.fleets.map((fleet) => (fleet.id === fleetId ? { ...fleet, scopes } : fleet)) });
        }
      }
    },
    endSignIns: () => {
      sessions.clear();
    },
    setDown: (isNowDown) => {
      isDown = isNowDown;
    },
    tokensIssued: () => issued,
    appsListsAsked: () => appsListsAsked,
    close: () =>
      new Promise((closed) => {
        server.close(() => {
          closed();
        });
      }),
  };
}

/** The shared sign-in of a browser, as the console's server would forward it. */
export function sharedSignInOf(cookies: readonly { name: string; value: string }[]): string | undefined {
  return cookies.find(({ name }) => name === COOKIE)?.value;
}
