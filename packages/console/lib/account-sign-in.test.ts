import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { signOutAccount, startSignIn } from './account-sign-in';
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
