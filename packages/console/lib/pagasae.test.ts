import { describe, expect, it } from 'vitest';

import { authorizeUrlOf, basicAuthOf, codeChallengeOf, exchangeSignIn, fleetsOf, pagasaeFrom, revokeSignIn } from './pagasae';

const PAGASAE = {
  url: 'https://account.example',
  clientId: 'console',
  clientSecret: 's'.repeat(32),
};

/** A pagasae that answers each request with the given status and body, and keeps what it was asked. */
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

describe('pagasae as the console reaches it', () => {
  it('is its address without a trailing slash, the client id and the client secret', () => {
    expect(
      pagasaeFrom({
        AEOLUS_PAGASAE_URL: 'https://account.example/',
        AEOLUS_PAGASAE_CLIENT_ID: 'console',
        AEOLUS_PAGASAE_CLIENT_SECRET: 's'.repeat(32),
      }),
    ).toEqual(PAGASAE);
  });

  it('is none unless all three are set', () => {
    expect(
      pagasaeFrom({
        AEOLUS_PAGASAE_URL: 'https://account.example',
        AEOLUS_PAGASAE_CLIENT_ID: 'console',
      }),
    ).toBeUndefined();
    expect(
      pagasaeFrom({
        AEOLUS_PAGASAE_CLIENT_ID: 'console',
        AEOLUS_PAGASAE_CLIENT_SECRET: 's'.repeat(32),
      }),
    ).toBeUndefined();
  });

  it('authenticates with HTTP Basic client credentials', () => {
    expect(basicAuthOf(PAGASAE)).toBe(`Basic ${Buffer.from(`console:${'s'.repeat(32)}`).toString('base64')}`);
  });
});

describe("the sign-in at pagasae's authorize endpoint", () => {
  it('asks for a code for the console, with the state and an S256 challenge', async () => {
    const url = new URL(
      authorizeUrlOf(PAGASAE, {
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
    const pagasae = answering(200, {
      access_token: 'eyJ.a.b',
      expires_in: 600,
      token_type: 'Bearer',
    });

    await expect(exchangeSignIn({ pagasae: PAGASAE, fetchImplementation: pagasae.fetchImplementation }, { signIn: 'cookie-value', fleetId: 'flt_1' })).resolves.toEqual({
      kind: 'token',
      token: 'eyJ.a.b',
      expiresInSeconds: 600,
    });
    const [asked] = pagasae.asked;
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
  ])('says $kind when pagasae answers $error', async ({ error, kind }) => {
    await expect(
      exchangeSignIn(
        {
          pagasae: PAGASAE,
          fetchImplementation: answering(400, { error }).fetchImplementation,
        },
        { signIn: 'c', fleetId: 'flt_1' },
      ),
    ).resolves.toEqual({ kind });
  });

  it('says unreachable when pagasae does not answer', async () => {
    await expect(
      exchangeSignIn(
        {
          pagasae: PAGASAE,
          fetchImplementation: () => Promise.reject(new Error('down')),
        },
        { signIn: 'c', fleetId: 'flt_1' },
      ),
    ).resolves.toEqual({ kind: 'unreachable' });
  });
});

describe('the fleets of the shared sign-in', () => {
  it('are those pagasae lists, each saying whether it opens the console', async () => {
    const pagasae = answering(200, {
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
          argo: false,
          apps: [{ app: 'gateway', url: 'https://gateway.example' }],
        },
      ],
    });

    await expect(fleetsOf({ pagasae: PAGASAE, fetchImplementation: pagasae.fetchImplementation }, 'cookie-value')).resolves.toEqual([
      { id: 'flt_1', name: 'acme', hasConsole: true },
      { id: 'flt_2', name: 'globex', hasConsole: false },
    ]);
    expect(pagasae.asked[0]?.headers.get('aeolus-sign-in')).toBe('cookie-value');
    expect(pagasae.asked[0]?.headers.get('authorization')).toBe(basicAuthOf(PAGASAE));
  });

  it('are none once the sign-in ended', async () => {
    await expect(
      fleetsOf(
        {
          pagasae: PAGASAE,
          fetchImplementation: answering(401, { error: 'invalid_grant' }).fetchImplementation,
        },
        'c',
      ),
    ).resolves.toBe('ended');
  });
});

describe('signing out at pagasae', () => {
  it('revokes the shared sign-in with the client credentials', async () => {
    const pagasae = answering(200, {});

    await expect(revokeSignIn({ pagasae: PAGASAE, fetchImplementation: pagasae.fetchImplementation }, 'cookie-value')).resolves.toBe(true);
    expect(Object.fromEntries(new URLSearchParams(await pagasae.asked[0]?.text()))).toEqual({
      token: 'cookie-value',
      client_id: 'console',
      client_secret: 's'.repeat(32),
    });
  });
});
