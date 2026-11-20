import { describe, expect, it } from 'vitest';

import { accountIdSchema, idSchema, type AppsList } from '@aeolus-fleet/common';

import { appsAndFleetsStateOf, isAccountSignIn, isArgoAllowedIn } from './app-switcher';

describe("whose apps list the header shows (header design H8)", () => {
  it("shows none for argo's sign-in, even one that came from the account app, nor for the viewer", () => {
    expect([isAccountSignIn('operator'), isAccountSignIn('viewer')]).toEqual([false, false]);
  });
});

describe("an account's own sign-in (accounts design C1)", () => {
  it('shows the apps list the account app gives the account', () => {
    expect(isAccountSignIn('account')).toBe(true);
  });
});

describe('whether the avatar menu offers Sign in as argo (accounts design, A7)', () => {
  const list = (fleets: { id: string; isArgoAllowed: boolean }[]): AppsList => ({
    account: { id: accountIdSchema.parse('acc-mathilde'), email: 'mathilde@acme.example' },
    apps: [],
    fleets: fleets.map(({ id, isArgoAllowed }) => ({ id: idSchema('fleet').parse(id), name: 'home fleet', argo: isArgoAllowed, apps: [] })),
  });
  const HOME = 'flt_01m5hhkr6z0ee92a3c29dsj1a2';
  const OTHER = 'flt_01m5hhkr6z0ee92a3c29dsj1a3';

  it('offers it when the apps list allows the account as argo of the fleet in view', () => {
    expect(isArgoAllowedIn(list([{ id: HOME, isArgoAllowed: true }]), HOME)).toBe(true);
  });

  it('does not offer it when only another fleet allows the account as argo', () => {
    expect(isArgoAllowedIn(list([{ id: HOME, isArgoAllowed: false }, { id: OTHER, isArgoAllowed: true }]), HOME)).toBe(false);
  });

  it('does not offer it before the apps list or the session answered', () => {
    expect([isArgoAllowedIn(undefined, HOME), isArgoAllowedIn(list([{ id: HOME, isArgoAllowed: true }]), undefined)]).toEqual([false, false]);
  });
});

describe('what the Apps and fleets panel shows of the apps list (docs/design/app-navigation, section 4)', () => {
  const HOME = idSchema('fleet').parse('flt_01m5hhkr6z0ee92a3c29dsj1a2');
  const LIST: AppsList = {
    account: { id: accountIdSchema.parse('acc-mathilde'), email: 'mathilde@acme.example' },
    apps: [{ app: 'account', url: 'https://account.acme.example/account' }],
    fleets: [{ id: HOME, name: 'Aeolus', argo: false, apps: [{ app: 'console', url: 'https://console.acme.example' }, { app: 'gateway', url: 'https://gateway.acme.example' }] }],
  };
  const read = (over: Partial<Parameters<typeof appsAndFleetsStateOf>[0]['read']> = {}) => ({ answer: undefined, isFetching: false, isFailed: false, hasRetried: false, ...over });

  it("shows tile and row shapes while an account's list is read", () => {
    expect(appsAndFleetsStateOf({ signedInAs: 'account', hasAccountApp: true, read: read({ isFetching: true }) })).toEqual({ state: { read: 'loading' }, list: undefined, isSignInExpired: false });
  });

  it("shows the account's apps and fleets once read", () => {
    expect(appsAndFleetsStateOf({ signedInAs: 'account', hasAccountApp: true, read: read({ answer: { kind: 'list', list: LIST } }) })).toEqual({ state: { read: 'loaded' }, list: LIST, isSignInExpired: false });
  });

  it('says it could not load them when the read failed, is busy on Try again, and says they were refreshed once read', () => {
    const failed = appsAndFleetsStateOf({ signedInAs: 'account', hasAccountApp: true, read: read({ isFailed: true }) });
    const retrying = appsAndFleetsStateOf({ signedInAs: 'account', hasAccountApp: true, read: read({ isFailed: true, isFetching: true, hasRetried: true }) });
    const refreshed = appsAndFleetsStateOf({ signedInAs: 'account', hasAccountApp: true, read: read({ answer: { kind: 'list', list: LIST }, hasRetried: true }) });

    expect([failed.state.read, retrying.state.read, refreshed.state.read]).toEqual(['failed', 'retrying', 'refreshed']);
  });

  it("explains argo's sign-in on an installation with the account app: Console alone", () => {
    expect(appsAndFleetsStateOf({ signedInAs: 'operator', hasAccountApp: true, read: read() })).toEqual({ state: { read: 'loaded', limit: 'argo' }, list: undefined, isSignInExpired: false });
  });

  it("explains the viewer's sign-in: Console alone", () => {
    expect(appsAndFleetsStateOf({ signedInAs: 'viewer', hasAccountApp: true, read: read() }).state).toEqual({ read: 'loaded', limit: 'viewer' });
  });

  it('explains a single-app installation, without the account app, to argo', () => {
    expect(appsAndFleetsStateOf({ signedInAs: 'operator', hasAccountApp: false, read: read() }).state).toEqual({ read: 'loaded', limit: 'single-app' });
  });

  it('marks every other app of the list held as needing sign-in once the account app says the sign-in ended, and the account button says so', () => {
    expect(appsAndFleetsStateOf({ signedInAs: 'account', hasAccountApp: true, read: read({ answer: { kind: 'ended', list: LIST } }) })).toEqual({
      state: { read: 'loaded', appAccess: { gateway: 'sign-in-required', account: 'sign-in-required' } },
      list: LIST,
      isSignInExpired: true,
    });
  });

  it('says the sign-in ended with no list held: Console alone', () => {
    expect(appsAndFleetsStateOf({ signedInAs: 'account', hasAccountApp: true, read: read({ answer: { kind: 'ended' } }) })).toEqual({ state: { read: 'loaded' }, list: undefined, isSignInExpired: true });
  });
});
