import { accountIdSchema, createIdGenerator, type AccountId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { accountNameFor, accountNamesFor, pagasaeFrom } from './account-name';

const PAGASAE = { AEOLUS_PAGASAE_URL: 'https://pagasae.example/', AEOLUS_PAGASAE_CONSOLE_TOKEN: 'c'.repeat(32), AEOLUS_SERVER_INTERNAL_URL: 'http://server:4000' };
const COOKIE = 'aeolus_session=abc';
const FLEET_ID = createIdGenerator()('fleet');

/** The fleet server and pagasae as the web app's server reaches them, answering by address and counting every call. */
function aWorld(options: { accountId?: string | null; pagasae?: Response | 'down'; names?: Readonly<Record<string, string>> } = {}) {
  const calls: { url: string; headers: Headers }[] = [];
  const answer = (data: unknown) => Response.json({ result: { data } });
  const fetchImplementation: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url === 'http://server:4000/trpc/console.session') {
      return Promise.resolve(answer({ fleetId: FLEET_ID, expiresAt: '2026-10-21T10:00:00.000Z', kind: 'operator', scopes: [] }));
    }
    if (url === 'http://server:4000/trpc/console.account') {
      const accountId = options.accountId === undefined ? 'acc-01mathilde' : options.accountId;
      return Promise.resolve(answer({ kind: 'operator', email: 'argo@example.com', theme: 'system', session: { device: 'Mac · Safari', since: '2026-10-20T09:00:00.000Z', accountId } }));
    }
    if (url.startsWith('https://pagasae.example/api/console/account-name') && options.names !== undefined) {
      const name = options.names[new URL(url).searchParams.get('accountId') ?? ''];
      return Promise.resolve(name === undefined ? Response.json({ error: 'not_found' }, { status: 404 }) : Response.json({ name }));
    }
    if (url.startsWith('https://pagasae.example/api/console/account-name')) {
      return options.pagasae === 'down' ? Promise.reject(new Error('no answer')) : Promise.resolve(options.pagasae ?? Response.json({ name: 'mathilde@acme.example' }));
    }
    return Promise.reject(new Error(`unexpected call to ${url}`));
  };
  return { calls, fetchImplementation };
}

describe("the name of the account signed in as argo (decisions 0054, 0058)", () => {
  it("is the name pagasae gives for the session's account in the session's fleet, asked with the console's token", async () => {
    const world = aWorld();

    await expect(accountNameFor({ environment: PAGASAE, cookie: COOKIE, fetchImplementation: world.fetchImplementation })).resolves.toBe('mathilde@acme.example');
    const asked = world.calls.find(({ url }) => url.startsWith('https://pagasae.example/'));
    expect(asked?.url).toBe(`https://pagasae.example/api/console/account-name?fleetId=${FLEET_ID}&accountId=acc-01mathilde`);
    expect(asked?.headers.get('x-aeolus-console-token')).toBe('c'.repeat(32));
  });

  it("is none for argo's own sign-in, which names no account, and pagasae is not asked", async () => {
    const world = aWorld({ accountId: null });

    await expect(accountNameFor({ environment: PAGASAE, cookie: COOKIE, fetchImplementation: world.fetchImplementation })).resolves.toBeNull();
    expect(world.calls.filter(({ url }) => url.startsWith('https://pagasae.example/'))).toEqual([]);
  });

  it('is none when pagasae has no name for it or does not answer, so the console shows the id', async () => {
    await expect(accountNameFor({ environment: PAGASAE, cookie: COOKIE, fetchImplementation: aWorld({ pagasae: Response.json({ error: 'not_found' }, { status: 404 }) }).fetchImplementation })).resolves.toBeNull();
    await expect(accountNameFor({ environment: PAGASAE, cookie: COOKIE, fetchImplementation: aWorld({ pagasae: 'down' }).fetchImplementation })).resolves.toBeNull();
  });

  it('is none, asking nobody, for a console without pagasae', async () => {
    const world = aWorld();

    await expect(accountNameFor({ environment: { AEOLUS_SERVER_INTERNAL_URL: 'http://server:4000' }, cookie: COOKIE, fetchImplementation: world.fetchImplementation })).resolves.toBeNull();
    expect(world.calls).toEqual([]);
  });
});

describe('the names of the accounts a timeline names as signed in as argo (decisions 0054, 0058)', () => {
  const mathilde = accountIdSchema.parse('acc-01mathilde');
  const lena = accountIdSchema.parse('acc-01lena');
  const pagasaeAsks = (world: ReturnType<typeof aWorld>) => world.calls.filter(({ url }) => url.startsWith('https://pagasae.example/'));

  it("are the names pagasae gives in the session's fleet, each account asked once with the console's token", async () => {
    const world = aWorld({ names: { 'acc-01mathilde': 'mathilde@acme.example', 'acc-01lena': 'lena@acme.example' } });

    await expect(accountNamesFor({ environment: PAGASAE, cookie: COOKIE, accountIds: [mathilde, lena, mathilde], fetchImplementation: world.fetchImplementation })).resolves.toEqual({
      'acc-01mathilde': 'mathilde@acme.example',
      'acc-01lena': 'lena@acme.example',
    });
    expect(pagasaeAsks(world).map(({ url }) => url)).toEqual([
      `https://pagasae.example/api/console/account-name?fleetId=${FLEET_ID}&accountId=acc-01mathilde`,
      `https://pagasae.example/api/console/account-name?fleetId=${FLEET_ID}&accountId=acc-01lena`,
    ]);
    expect(pagasaeAsks(world).every(({ headers }) => headers.get('x-aeolus-console-token') === 'c'.repeat(32))).toBe(true);
  });

  it('leave out an account pagasae gives no name, so it shows by its id', async () => {
    const world = aWorld({ names: { 'acc-01lena': 'lena@acme.example' } });

    await expect(accountNamesFor({ environment: PAGASAE, cookie: COOKIE, accountIds: [mathilde, lena], fetchImplementation: world.fetchImplementation })).resolves.toEqual({ 'acc-01lena': 'lena@acme.example' });
  });

  it('are none while pagasae does not answer', async () => {
    await expect(accountNamesFor({ environment: PAGASAE, cookie: COOKIE, accountIds: [mathilde], fetchImplementation: aWorld({ pagasae: 'down' }).fetchImplementation })).resolves.toEqual({});
  });

  it.each<{ label: string; environment: Readonly<Record<string, string | undefined>>; accountIds: AccountId[] }>([
    { label: 'for a console without pagasae', environment: { AEOLUS_SERVER_INTERNAL_URL: 'http://server:4000' }, accountIds: [mathilde] },
    { label: 'for no accounts', environment: PAGASAE, accountIds: [] },
  ])('are none, asking nobody, $label', async ({ environment, accountIds }) => {
    const world = aWorld();

    await expect(accountNamesFor({ environment, cookie: COOKIE, accountIds, fetchImplementation: world.fetchImplementation })).resolves.toEqual({});
    expect(world.calls).toEqual([]);
  });
});

describe('pagasae as the console reaches it', () => {
  it('is its address without a trailing slash and the console token', () => {
    expect(pagasaeFrom(PAGASAE)).toEqual({ url: 'https://pagasae.example', token: 'c'.repeat(32) });
  });

  it('is none unless both are set', () => {
    expect(pagasaeFrom({ AEOLUS_PAGASAE_URL: 'https://pagasae.example' })).toBeUndefined();
    expect(pagasaeFrom({ AEOLUS_PAGASAE_CONSOLE_TOKEN: 'c'.repeat(32) })).toBeUndefined();
  });
});
