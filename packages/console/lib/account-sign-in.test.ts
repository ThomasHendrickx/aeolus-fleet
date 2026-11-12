import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { enterFleet, signOutAccount, startSignIn } from './account-sign-in';
import { signOutOfArgo } from './argo-sign-in';

/** Where the web app's server listens behind the proxy: what request.url holds there. */
const BIND_ADDRESS = 'https://0.0.0.0:3000';
/** The console's public address, as the operator configures it. */
const CONSOLE_URL = 'https://fleet.example.com';

const PAGASAE = { url: 'https://account.example', clientId: 'console', clientSecret: 's'.repeat(32) };

const stopAll: (() => void)[] = [];
afterEach(() => {
  for (const stop of stopAll.splice(0)) {
    stop();
  }
});

/** A core answering every call with 200, keeping the origin header of each. */
async function aCoreKeepingOrigins(): Promise<{ url: string; origins: (string | undefined)[] }> {
  const origins: (string | undefined)[] = [];
  const server = createServer((request, response) => {
    origins.push(request.headers.origin);
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  stopAll.push(() => server.close());
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the stub core listens on no port');
  }
  return { url: `http://127.0.0.1:${String(address.port)}`, origins };
}

describe("the console's addresses behind a proxy", () => {
  it('sends pagasae the redirect on the configured console address, not the bind address', async () => {
    const started = await startSignIn(new Request(`${BIND_ADDRESS}/sign-in/start`), { pagasae: PAGASAE, environment: { AEOLUS_CONSOLE_URL: CONSOLE_URL } });

    const authorize = new URL(started.headers.get('location') ?? '');
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://fleet.example.com/sign-in/done');
  });

  it('signs out at core with the configured console address as origin', async () => {
    const core = await aCoreKeepingOrigins();

    await signOutAccount(new Request(`${BIND_ADDRESS}/sign-in/out`), { pagasae: PAGASAE, environment: { AEOLUS_CONSOLE_URL: CONSOLE_URL, AEOLUS_SERVER_INTERNAL_URL: core.url } });

    expect(core.origins).toEqual(['https://fleet.example.com']);
  });

  it("takes a sign-out of argo from a page on the configured console address", async () => {
    const answer = await signOutOfArgo(new Request(`${BIND_ADDRESS}/sign-in/argo/out`, { method: 'POST', headers: { origin: CONSOLE_URL } }), { AEOLUS_CONSOLE_URL: CONSOLE_URL });

    expect(answer.status).toBe(204);
  });

  it('refuses a sign-out of argo from another origin', async () => {
    const answer = await signOutOfArgo(new Request(`${BIND_ADDRESS}/sign-in/argo/out`, { method: 'POST', headers: { origin: 'https://elsewhere.example' } }), { AEOLUS_CONSOLE_URL: CONSOLE_URL });

    expect(answer.status).toBe(403);
  });

  it('signs out of argo at core with the configured console address as origin', async () => {
    const core = await aCoreKeepingOrigins();

    await signOutOfArgo(
      new Request(`${BIND_ADDRESS}/sign-in/argo/out`, { method: 'POST', headers: { origin: CONSOLE_URL, cookie: 'aeolus_session=ses_x' } }),
      { AEOLUS_CONSOLE_URL: CONSOLE_URL, AEOLUS_SERVER_INTERNAL_URL: core.url },
    );

    expect(core.origins).toEqual(['https://fleet.example.com']);
  });

  it('keeps the request address when no console address is configured, as in development', async () => {
    const started = await startSignIn(new Request('http://localhost:3000/sign-in/start'), { pagasae: PAGASAE, environment: {} });

    const authorize = new URL(started.headers.get('location') ?? '');
    expect(authorize.searchParams.get('redirect_uri')).toBe('http://localhost:3000/sign-in/done');
  });
});

/** One server standing for pagasae and for core: the account holds rights in fleet_a and fleet_b, core takes the token, and signing out of argo answers as given. */
async function aPagasaeAndCore(signOutStatus: number): Promise<{ url: string }> {
  const bodyOf: Record<string, unknown> = {
    '/api/apps': { fleets: ['fleet_a', 'fleet_b'].map((id) => ({ id, name: id, argo: true, apps: [{ app: 'console' }] })) },
    '/oauth/token': { access_token: 'account-token', expires_in: 600 },
  };
  const server = createServer((request, response) => {
    const json = (status: number, cookie?: string): void => {
      response.writeHead(status, { 'content-type': 'application/json', ...(cookie === undefined ? {} : { 'set-cookie': cookie }) }).end(JSON.stringify(bodyOf[request.url ?? ''] ?? {}));
    };
    request.resume();
    if (request.url === '/trpc/console.presentAccountToken') {
      json(200, 'aeolus_account_token=account-token; Path=/');
    } else if (request.url === '/trpc/console.signOut') {
      json(signOutStatus, signOutStatus === 200 ? 'aeolus_session=; Max-Age=0; Path=/' : undefined);
    } else {
      json(request.url !== undefined && request.url in bodyOf ? 200 : 404);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  stopAll.push(() => server.close());
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the stub listens on no port');
  }
  return { url: `http://127.0.0.1:${String(address.port)}` };
}

/** A switch from fleet_a to fleet_b by an account signed in as argo of fleet_a. */
function aSwitchAsArgo(stub: { url: string }): Promise<Response> {
  return enterFleet(
    new Request(`${BIND_ADDRESS}/sign-in/enter?fleet=fleet_b&returnTo=%2F`, {
      headers: { cookie: 'aeolus_account_session=shared; aeolus_console_fleet=fleet_a; aeolus_session=ses_x' },
    }),
    { pagasae: { ...PAGASAE, url: stub.url }, environment: { AEOLUS_CONSOLE_URL: CONSOLE_URL, AEOLUS_SERVER_INTERNAL_URL: stub.url }, returnTo: '/' },
  );
}

describe('switching to another fleet while signed in as argo', () => {
  it('ends argo\'s sign-in and opens the other fleet when core signs out', async () => {
    const answer = await aSwitchAsArgo(await aPagasaeAndCore(200));

    expect(answer.headers.get('location')).toBe('/');
    const cookies = answer.headers.getSetCookie();
    expect(cookies).toContain('aeolus_session=; Max-Age=0; Path=/');
    expect(cookies.some((cookie) => cookie.startsWith('aeolus_console_fleet=fleet_b;'))).toBe(true);
  });

  it('does not switch when core fails the sign-out: argo stays signed in to the first fleet and the console says so', async () => {
    const answer = await aSwitchAsArgo(await aPagasaeAndCore(500));

    expect(answer.headers.get('location')).toBe('/sign-in/switch-failed');
    expect(answer.headers.getSetCookie()).toEqual([]);
  });
});
