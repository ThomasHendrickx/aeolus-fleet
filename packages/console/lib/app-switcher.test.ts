import { describe, expect, it } from 'vitest';

import { accountIdSchema, idSchema, type AppsList } from '@aeolus-fleet/common';

import { isAccountSignIn, isArgoAllowedIn } from './app-switcher';

describe("whose apps list the header shows (header design H8)", () => {
  it("shows none for argo's sign-in, even one that came from pagasae, nor for the viewer", () => {
    expect([isAccountSignIn('operator'), isAccountSignIn('viewer')]).toEqual([false, false]);
  });
});

describe("an account's own sign-in (accounts design C1)", () => {
  it('shows the apps list pagasae gives the account', () => {
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
