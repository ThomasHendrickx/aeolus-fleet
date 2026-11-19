import { afterEach, describe, expect, it, vi } from 'vitest';

import { authorizeUrlOf, basicAuthOf, codeChallengeOf, exchangeArgoTicket, exchangeSignIn, fleetsOf, accountAppFrom, revokeSignIn } from './account-app';

const ACCOUNT_APP = {
  url: 'https://account.example',
  clientId: 'console',
  clientSecret: 's'.repeat(32),
};

/** A the account app that answers each request with the given status and body, and keeps what it was asked. */
function answering(status: number, body: unknown) {
  const asked: Request[] = [];
  const fetchImplementation: typeof fetch = (input, init) => {
    asked.push(new Request(input, init));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { asked, fetchImplementation };
}

describe('the account app as the console reaches it', () => {
  it('is its address without a trailing slash, the client id and the client secret', () => {
    expect(
      accountAppFrom({
        AEOLUS_ACCOUNT_APP_URL: 'https://account.example/',
        AEOLUS_ACCOUNT_APP_CLIENT_ID: 'console',
        AEOLUS_ACCOUNT_APP_CLIENT_SECRET: 's'.repeat(32),
      }),
    ).toEqual(ACCOUNT_APP);
  });

  it('is none unless all three are set', () => {
    expect(
      accountAppFrom({
        AEOLUS_ACCOUNT_APP_URL: 'https://account.example',
        AEOLUS_ACCOUNT_APP_CLIENT_ID: 'console',
      }),
    ).toBeUndefined();
    expect(
      accountAppFrom({
        AEOLUS_ACCOUNT_APP_CLIENT_ID: 'console',
        AEOLUS_ACCOUNT_APP_CLIENT_SECRET: 's'.repeat(32),
      }),
    ).toBeUndefined();
  });

  it('authenticates with HTTP Basic client credentials', () => {
    expect(basicAuthOf(ACCOUNT_APP)).toBe(`Basic ${Buffer.from(`console:${'s'.repeat(32)}`).toString('base64')}`);
  });
});

describe("the sign-in at the account app's authorize endpoint", () => {
  it('asks for a code for the console, with the state and an S256 challenge', async () => {
    const url = new URL(
      authorizeUrlOf(ACCOUNT_APP, {
        redirectUri: 'https://fleet.example/sign-in/done',
        state: 'st',
        codeChallenge: await codeChallengeOf('verifier'),
      }),
    );

    expect(url.origin + url.pathname).toBe('https://account.example/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'console',
      redirect_uri: 'https://fleet.example/sign-in/done',
      state: 'st',
      // RFC 7636, appendix B's method: base64url of SHA-256, no padding.
      code_challenge: 'iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ',
      code_challenge_method: 'S256',
    });
  });
});

describe('an account token for a fleet, from the shared sign-in', () => {
  it('is exchanged with the sign-in cookie for the fleet, with the client credentials in the body', async () => {
    const accountApp = answering(200, {
      access_token: 'eyJ.a.b',
      expires_in: 600,
      token_type: 'Bearer',
    });

    await expect(exchangeSignIn({ accountApp: ACCOUNT_APP, fetchImplementation: accountApp.fetchImplementation }, { signIn: 'cookie-value', fleetId: 'flt_1' })).resolves.toEqual({
      kind: 'token',
      token: 'eyJ.a.b',
      expiresInSeconds: 600,
    });
    const [asked] = accountApp.asked;
    expect(asked?.url).toBe('https://account.example/oauth/token');
    expect(Object.fromEntries(new URLSearchParams(await asked?.text()))).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: 'cookie-value',
      subject_token_type: 'urn:aeolus:params:oauth:token-type:sign-in',
      resource: 'flt_1',
      client_id: 'console',
      client_secret: 's'.repeat(32),
    });
  });

  it.each([
    { error: 'invalid_grant', kind: 'ended' },
    { error: 'invalid_target', kind: 'noRights' },
    { error: 'invalid_client', kind: 'unreachable' },
  ])('says $kind when the account app answers $error', async ({ error, kind }) => {
    await expect(
      exchangeSignIn(
        {
          accountApp: ACCOUNT_APP,
          fetchImplementation: answering(400, { error }).fetchImplementation,
        },
        { signIn: 'c', fleetId: 'flt_1' },
      ),
    ).resolves.toEqual({ kind });
  });

  it('says unreachable when the account app does not answer', async () => {
    await expect(
      exchangeSignIn(
        {
          accountApp: ACCOUNT_APP,
          fetchImplementation: () => Promise.reject(new Error('down')),
        },
        { signIn: 'c', fleetId: 'flt_1' },
      ),
    ).resolves.toEqual({ kind: 'unreachable' });
  });
});

describe("core's ticket to sign in as argo of a fleet, from the shared sign-in (accounts design, F4)", () => {
  it('is exchanged with the sign-in cookie for the fleet, asking for the argo sign-in ticket', async () => {
    const accountApp = answering(200, { access_token: 'ticket-1', issued_token_type: 'urn:aeolus:params:oauth:token-type:argo-sign-in-ticket', token_type: 'N_A', expires_in: 120 });

    await expect(exchangeArgoTicket({ accountApp: ACCOUNT_APP, fetchImplementation: accountApp.fetchImplementation }, { signIn: 'cookie-value', fleetId: 'flt_1' })).resolves.toEqual({
      kind: 'ticket',
      ticket: 'ticket-1',
    });
    expect(Object.fromEntries(new URLSearchParams(await accountApp.asked[0]?.text()))).toMatchObject({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: 'cookie-value',
      resource: 'flt_1',
      requested_token_type: 'urn:aeolus:params:oauth:token-type:argo-sign-in-ticket',
    });
  });

  it.each([
    { error: 'invalid_grant', kind: 'ended' },
    { error: 'invalid_target', kind: 'notAllowed' },
    { error: 'unauthorized_client', kind: 'unreachable' },
  ])('says $kind when the account app answers $error', async ({ error, kind }) => {
    await expect(exchangeArgoTicket({ accountApp: ACCOUNT_APP, fetchImplementation: answering(400, { error }).fetchImplementation }, { signIn: 'c', fleetId: 'flt_1' })).resolves.toEqual({ kind });
  });
});

describe('the fleets of the shared sign-in', () => {
  it('are those the account app lists, each saying whether it opens the console and whether the account may sign in as argo there', async () => {
    const accountApp = answering(200, {
      account: { id: 'acc-1', email: 'm@example.com' },
      apps: [],
      fleets: [
        {
          id: 'flt_1',
          name: 'acme',
          argo: false,
          apps: [{ app: 'console', url: 'https://fleet.example' }],
        },
        {
          id: 'flt_2',
          name: 'globex',
          argo: true,
          apps: [{ app: 'gateway', url: 'https://gateway.example' }],
        },
      ],
    });

    await expect(fleetsOf({ accountApp: ACCOUNT_APP, fetchImplementation: accountApp.fetchImplementation }, 'cookie-value')).resolves.toEqual([
      { id: 'flt_1', name: 'acme', hasConsole: true, isArgoAllowed: false },
      { id: 'flt_2', name: 'globex', hasConsole: false, isArgoAllowed: true },
    ]);
    expect(accountApp.asked[0]?.headers.get('aeolus-sign-in')).toBe('cookie-value');
    expect(accountApp.asked[0]?.headers.get('authorization')).toBe(basicAuthOf(ACCOUNT_APP));
  });

  it('are none once the sign-in ended', async () => {
    await expect(
      fleetsOf(
        {
          accountApp: ACCOUNT_APP,
          fetchImplementation: answering(401, { error: 'invalid_grant' }).fetchImplementation,
        },
        'c',
      ),
    ).resolves.toBe('ended');
  });
});

describe('signing out at the account app', () => {
  it('revokes the shared sign-in with the client credentials', async () => {
    const accountApp = answering(200, {});

    await expect(revokeSignIn({ accountApp: ACCOUNT_APP, fetchImplementation: accountApp.fetchImplementation }, 'cookie-value')).resolves.toBe(true);
    expect(Object.fromEntries(new URLSearchParams(await accountApp.asked[0]?.text()))).toEqual({
      token: 'cookie-value',
      client_id: 'console',
      client_secret: 's'.repeat(32),
    });
  });
});

describe('why the console says the account app is unreachable', () => {
  const SIGN_IN = { signIn: 'cookie-secret', fleetId: 'flt_1' };

  /** What the console's server logged as a warning, joined. */
  function logged(warn: { mock: { calls: unknown[][] } }): string {
    return warn.mock.calls.map((call) => call.join(' ')).join('\n');
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the token exchange and a timeout', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const timeout = new DOMException('The operation timed out.', 'TimeoutError');
    await exchangeSignIn({ accountApp: ACCOUNT_APP, fetchImplementation: () => Promise.reject(timeout) }, SIGN_IN);
    expect(logged(warn)).toContain('the account app unreachable: token exchange: timeout after 10000 ms');
  });

  it('names the argo ticket exchange and a network error with its cause', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failure = new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
    await exchangeArgoTicket({ accountApp: ACCOUNT_APP, fetchImplementation: () => Promise.reject(failure) }, SIGN_IN);
    expect(logged(warn)).toContain('the account app unreachable: argo ticket exchange: network error TypeError ECONNRESET');
  });

  it('names the apps list and the status the account app answered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await fleetsOf({ accountApp: ACCOUNT_APP, fetchImplementation: answering(502, { error: 'bad_gateway' }).fetchImplementation }, 'cookie-secret');
    expect(logged(warn)).toContain('the account app unreachable: apps list: status 502');
  });

  it('names an unparseable body with its status', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const html: typeof fetch = () => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 }));
    await exchangeSignIn({ accountApp: ACCOUNT_APP, fetchImplementation: html }, SIGN_IN);
    expect(logged(warn)).toContain('the account app unreachable: token exchange: status 502, unparseable body');
  });

  it('names the OAuth error the account app answered that the console does not map', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await exchangeSignIn({ accountApp: ACCOUNT_APP, fetchImplementation: answering(400, { error: 'invalid_client' }).fetchImplementation }, SIGN_IN);
    expect(logged(warn)).toContain('the account app unreachable: token exchange: status 400, error invalid_client');
  });

  it('names an answer without a token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await exchangeSignIn({ accountApp: ACCOUNT_APP, fetchImplementation: answering(200, { access_token: 'tok-secret' }).fetchImplementation }, SIGN_IN);
    expect(logged(warn)).toContain('the account app unreachable: token exchange: status 200, answer without the expected fields');
  });

  it('logs no secret, token, sign-in or body', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await exchangeSignIn({ accountApp: ACCOUNT_APP, fetchImplementation: answering(200, { access_token: 'tok-secret' }).fetchImplementation }, SIGN_IN);
    await fleetsOf({ accountApp: ACCOUNT_APP, fetchImplementation: answering(500, { detail: 'body-secret' }).fetchImplementation }, 'cookie-secret');
    const output = logged(warn);
    for (const secret of [ACCOUNT_APP.clientSecret, 'tok-secret', 'cookie-secret', 'body-secret']) {
      expect(output).not.toContain(secret);
    }
  });

  it('logs nothing when the account app answers a mapped outcome', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await exchangeSignIn({ accountApp: ACCOUNT_APP, fetchImplementation: answering(400, { error: 'invalid_grant' }).fetchImplementation }, SIGN_IN);
    expect(warn).not.toHaveBeenCalled();
  });
});
