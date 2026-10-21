import { describe, expect, it } from 'vitest';

import { isAccountSignIn } from './app-switcher';

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
