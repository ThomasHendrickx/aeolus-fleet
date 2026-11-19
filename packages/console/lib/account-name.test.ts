import { accountIdSchema, createIdGenerator, type AccountId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { accountNameFor, accountNamesFor } from './account-name';

const CLIENT_AUTH = `Basic ${Buffer.from(`console:${'c'.repeat(32)}`).toString('base64')}`;
const ACCOUNT_APP = { AEOLUS_ACCOUNT_APP_URL: 'https://account-app.example/', AEOLUS_ACCOUNT_APP_CLIENT_ID: 'console', AEOLUS_ACCOUNT_APP_CLIENT_SECRET: 'c'.repeat(32), AEOLUS_SERVER_INTERNAL_URL: 'http://server:4000' };
const COOKIE = 'aeolus_session=abc';
const FLEET_ID = createIdGenerator()('fleet');

/** The fleet server and the account app as the web app's server reaches them, answering by address and counting every call. */
function aWorld(options: { accountId?: string | null; accountApp?: Response | 'down'; names?: Readonly<Record<string, string>>; deleted?: readonly string[] } = {}) {
  const calls: { url: string; headers: Headers }[] = [];
  const answer = (data: unknown) => Response.json({ result: { data } });
  const fetchImplementation: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url === 'http://server:4000/trpc/console.session') {
      return Promise.resolve(answer({ fleetId: FLEET_ID, fleetName: 'Acme', expiresAt: '2026-10-21T10:00:00.000Z', kind: 'operator', scopes: [], featureFlags: [] }));
    }
    if (url === 'http://server:4000/trpc/console.account') {
      const accountId = options.accountId === undefined ? 'acc-01mathilde' : options.accountId;
      return Promise.resolve(answer({ kind: 'operator', email: 'argo@example.com', hasPassword: true, session: { device: 'Mac · Safari', since: '2026-10-20T09:00:00.000Z', accountId } }));
    }
    if (url.startsWith('https://account-app.example/api/console/account-name') && options.names !== undefined) {
      const accountId = new URL(url).searchParams.get('accountId') ?? '';
      if (options.deleted?.includes(accountId) === true) {
        return Promise.resolve(Response.json({ error: 'deleted' }, { status: 410 }));
      }
      const name = options.names[accountId];
      return Promise.resolve(name === undefined ? Response.json({ error: 'not_found' }, { status: 404 }) : Response.json({ name }));
    }
    if (url.startsWith('https://account-app.example/api/console/account-name')) {
      return options.accountApp === 'down' ? Promise.reject(new Error('no answer')) : Promise.resolve(options.accountApp ?? Response.json({ name: 'mathilde@acme.example' }));
    }
    return Promise.reject(new Error(`unexpected call to ${url}`));
  };
  return { calls, fetchImplementation };
}

describe("the name of the account signed in as argo (decisions 0054, 0058)", () => {
  it("is the name the account app gives for the session's account in the session's fleet, asked with the console's client credentials", async () => {
    const world = aWorld();

    await expect(accountNameFor({ environment: ACCOUNT_APP, cookie: COOKIE, fetchImplementation: world.fetchImplementation })).resolves.toBe('mathilde@acme.example');
    const asked = world.calls.find(({ url }) => url.startsWith('https://account-app.example/'));
    expect(asked?.url).toBe(`https://account-app.example/api/console/account-name?fleetId=${FLEET_ID}&accountId=acc-01mathilde`);
    expect(asked?.headers.get('authorization')).toBe(CLIENT_AUTH);
  });

  it("is none for argo's own sign-in, which names no account, and the account app is not asked", async () => {
    const world = aWorld({ accountId: null });

    await expect(accountNameFor({ environment: ACCOUNT_APP, cookie: COOKIE, fetchImplementation: world.fetchImplementation })).resolves.toBeNull();
    expect(world.calls.filter(({ url }) => url.startsWith('https://account-app.example/'))).toEqual([]);
  });

  it('is none when the account app has no name for it or does not answer, so the console shows the id', async () => {
    await expect(accountNameFor({ environment: ACCOUNT_APP, cookie: COOKIE, fetchImplementation: aWorld({ accountApp: Response.json({ error: 'not_found' }, { status: 404 }) }).fetchImplementation })).resolves.toBeNull();
    await expect(accountNameFor({ environment: ACCOUNT_APP, cookie: COOKIE, fetchImplementation: aWorld({ accountApp: 'down' }).fetchImplementation })).resolves.toBeNull();
  });

  it('is Deleted user when the account app answers that the account was deleted', async () => {
    const world = aWorld({ accountApp: Response.json({ error: 'deleted' }, { status: 410 }) });

    await expect(accountNameFor({ environment: ACCOUNT_APP, cookie: COOKIE, fetchImplementation: world.fetchImplementation })).resolves.toBe('Deleted user');
  });

  it('is none, asking nobody, for a console without the account app', async () => {
    const world = aWorld();

    await expect(accountNameFor({ environment: { AEOLUS_SERVER_INTERNAL_URL: 'http://server:4000' }, cookie: COOKIE, fetchImplementation: world.fetchImplementation })).resolves.toBeNull();
    expect(world.calls).toEqual([]);
  });
});

describe('the names of the accounts a timeline names as signed in as argo (decisions 0054, 0058)', () => {
  const mathilde = accountIdSchema.parse('acc-01mathilde');
  const lena = accountIdSchema.parse('acc-01lena');
  const accountAppAsks = (world: ReturnType<typeof aWorld>) => world.calls.filter(({ url }) => url.startsWith('https://account-app.example/'));

  it("are the names the account app gives in the session's fleet, each account asked once with the console's client credentials", async () => {
    const world = aWorld({ names: { 'acc-01mathilde': 'mathilde@acme.example', 'acc-01lena': 'lena@acme.example' } });

    await expect(accountNamesFor({ environment: ACCOUNT_APP, cookie: COOKIE, accountIds: [mathilde, lena, mathilde], fetchImplementation: world.fetchImplementation })).resolves.toEqual({
      'acc-01mathilde': 'mathilde@acme.example',
      'acc-01lena': 'lena@acme.example',
    });
    expect(accountAppAsks(world).map(({ url }) => url)).toEqual([
      `https://account-app.example/api/console/account-name?fleetId=${FLEET_ID}&accountId=acc-01mathilde`,
      `https://account-app.example/api/console/account-name?fleetId=${FLEET_ID}&accountId=acc-01lena`,
    ]);
    expect(accountAppAsks(world).every(({ headers }) => headers.get('authorization') === CLIENT_AUTH)).toBe(true);
  });

  it('leave out an account the account app gives no name, so it shows by its id', async () => {
    const world = aWorld({ names: { 'acc-01lena': 'lena@acme.example' } });

    await expect(accountNamesFor({ environment: ACCOUNT_APP, cookie: COOKIE, accountIds: [mathilde, lena], fetchImplementation: world.fetchImplementation })).resolves.toEqual({ 'acc-01lena': 'lena@acme.example' });
  });

  it('name an account the account app answers was deleted Deleted user', async () => {
    const world = aWorld({ names: { 'acc-01lena': 'lena@acme.example' }, deleted: ['acc-01mathilde'] });

    await expect(accountNamesFor({ environment: ACCOUNT_APP, cookie: COOKIE, accountIds: [mathilde, lena], fetchImplementation: world.fetchImplementation })).resolves.toEqual({
      'acc-01mathilde': 'Deleted user',
      'acc-01lena': 'lena@acme.example',
    });
  });

  it('are none while the account app does not answer', async () => {
    await expect(accountNamesFor({ environment: ACCOUNT_APP, cookie: COOKIE, accountIds: [mathilde], fetchImplementation: aWorld({ accountApp: 'down' }).fetchImplementation })).resolves.toEqual({});
  });

  it.each<{ label: string; environment: Readonly<Record<string, string | undefined>>; accountIds: AccountId[] }>([
    { label: 'for a console without the account app', environment: { AEOLUS_SERVER_INTERNAL_URL: 'http://server:4000' }, accountIds: [mathilde] },
    { label: 'for no accounts', environment: ACCOUNT_APP, accountIds: [] },
  ])('are none, asking nobody, $label', async ({ environment, accountIds }) => {
    const world = aWorld();

    await expect(accountNamesFor({ environment, cookie: COOKIE, accountIds, fetchImplementation: world.fetchImplementation })).resolves.toEqual({});
    expect(world.calls).toEqual([]);
  });
});
