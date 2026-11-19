import { describe, expect, it } from 'vitest';

import { appsListFor, sharedSignInOf } from './apps-list';

const ACCOUNT_APP = { AEOLUS_ACCOUNT_APP_URL: 'https://account-app.example/', AEOLUS_ACCOUNT_APP_CLIENT_ID: 'console', AEOLUS_ACCOUNT_APP_CLIENT_SECRET: 's'.repeat(32) };
const COOKIE = 'aeolus_session=argo; aeolus_account_session=sgn-charlotte';
const LIST = {
  account: { id: 'acc-charlotte', email: 'charlotte@acme.example' },
  apps: [{ app: 'account', url: 'https://account-app.example/account' }],
  fleets: [{ id: 'flt_01m5fcd917vwf30mx663fgc3z8', name: 'Acme', argo: false, apps: [{ app: 'console', url: 'https://fleet.example' }] }],
};

/** the account app as a fetch: the given answer, and every request it was asked. */
function aAccountApp(answer: () => Response) {
  const asked: Request[] = [];
  const fetchImplementation: typeof fetch = (url, init) => {
    asked.push(new Request(url, init));
    return Promise.resolve(answer());
  };
  return { asked, fetchImplementation };
}

describe('the apps and fleets the signed-in account may open (header design H1)', () => {
  it("is the account app's list, asked with the console's app credentials and the shared sign-in", async () => {
    const accountApp = aAccountApp(() => Response.json(LIST));

    await expect(appsListFor({ environment: ACCOUNT_APP, cookieHeader: COOKIE, fetchImplementation: accountApp.fetchImplementation })).resolves.toEqual(LIST);
    expect(accountApp.asked.map((request) => ({ url: request.url, authorization: request.headers.get('authorization'), signIn: request.headers.get('aeolus-sign-in') }))).toEqual([
      { url: 'https://account-app.example/api/apps', authorization: `Basic ${btoa(`console:${'s'.repeat(32)}`)}`, signIn: 'sgn-charlotte' },
    ]);
  });

  it('is none without the shared sign-in, and the account app is not asked', async () => {
    const accountApp = aAccountApp(() => Response.json(LIST));

    await expect(appsListFor({ environment: ACCOUNT_APP, cookieHeader: 'aeolus_session=argo', fetchImplementation: accountApp.fetchImplementation })).resolves.toBeNull();
    expect(accountApp.asked).toEqual([]);
  });

  it('is none without the account app (self-hosted)', async () => {
    const accountApp = aAccountApp(() => Response.json(LIST));

    await expect(appsListFor({ environment: {}, cookieHeader: COOKIE, fetchImplementation: accountApp.fetchImplementation })).resolves.toBeNull();
  });

  it('is none when the account app refuses the sign-in', async () => {
    const accountApp = aAccountApp(() => Response.json({ error: 'invalid_grant' }, { status: 401 }));

    await expect(appsListFor({ environment: ACCOUNT_APP, cookieHeader: COOKIE, fetchImplementation: accountApp.fetchImplementation })).resolves.toBeNull();
  });

  it('is none when the account app answers a shape it does not know', async () => {
    const accountApp = aAccountApp(() => Response.json({ apps: 'all' }));

    await expect(appsListFor({ environment: ACCOUNT_APP, cookieHeader: COOKIE, fetchImplementation: accountApp.fetchImplementation })).resolves.toBeNull();
  });

  it('is none when the account app does not answer', async () => {
    const fetchImplementation: typeof fetch = () => Promise.reject(new Error('connect ECONNREFUSED'));

    await expect(appsListFor({ environment: ACCOUNT_APP, cookieHeader: COOKIE, fetchImplementation })).resolves.toBeNull();
  });
});

describe('the shared sign-in in a Cookie header', () => {
  it('is the aeolus_account_session cookie', () => {
    expect(sharedSignInOf('a=1; aeolus_account_session=sgn%3Dx; b=2')).toBe('sgn=x');
  });

  it('is none without it', () => {
    expect(sharedSignInOf('aeolus_session=argo')).toBeUndefined();
  });
});
