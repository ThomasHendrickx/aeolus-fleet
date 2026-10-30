import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  THEMES,
  accountOutputSchema,
  consoleSessionOutputSchema,
  presentAccountTokenInputSchema,
  redeemSignInTicketInputSchema,
  setLoginInputSchema,
  setThemeInputSchema,
  signInInputSchema,
} from './console.js';

const newId = createIdGenerator();

describe('signInInputSchema', () => {
  it('accepts an email and a password', () => {
    expect(signInInputSchema.parse({ email: 'thomas@example.com', password: 'correct horse' })).toEqual({
      email: 'thomas@example.com',
      password: 'correct horse',
    });
  });

  it('drops whitespace around the email, and keeps the password exactly as typed', () => {
    expect(signInInputSchema.parse({ email: ' thomas@example.com\n', password: ' correct horse ' })).toEqual({
      email: 'thomas@example.com',
      password: ' correct horse ',
    });
  });

  it('takes any email the server may know: its shape is not checked, so a wrong one is only wrong', () => {
    expect(signInInputSchema.safeParse({ email: 'thomas', password: 'correct horse' }).success).toBe(true);
  });

  it.each([
    ['a missing email', { password: 'correct horse' }],
    ['an empty email', { email: ' ', password: 'correct horse' }],
    ['an email over 254 characters', { email: `${'a'.repeat(243)}@example.com`, password: 'correct horse' }],
    ['a missing password', { email: 'thomas@example.com' }],
    ['an empty password', { email: 'thomas@example.com', password: '' }],
    ['a password over 1024 characters', { email: 'thomas@example.com', password: 'p'.repeat(1025) }],
    ["argo's secret alone", { secret: 'aeolus_sk_v1_abc' }],
  ])('rejects %s', (_label, input) => {
    expect(signInInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('THEMES', () => {
  it('knows Light, Dark and System', () => {
    expect(THEMES).toEqual(['light', 'dark', 'system']);
  });
});

describe('consoleSessionOutputSchema', () => {
  const output = { fleetId: newId('fleet'), fleetName: 'Acme', expiresAt: '2026-11-01T19:00:00.000Z', kind: 'operator', scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'], featureFlags: ['sealing'] };

  it("answers the session's fleet and its name, when it expires, and whose it is: the operator's or a viewer's, with the ship's scopes", () => {
    expect(consoleSessionOutputSchema.parse(output)).toEqual(output);
    expect(consoleSessionOutputSchema.parse({ ...output, kind: 'viewer', scopes: ['fleet:read'] })).toMatchObject({ kind: 'viewer', scopes: ['fleet:read'] });
  });

  it('rejects an expiry that is not ISO 8601', () => {
    expect(consoleSessionOutputSchema.safeParse({ ...output, expiresAt: 'soon' }).success).toBe(false);
  });

  it('rejects an agent: only the operator, a viewer and an account sign in to the console', () => {
    expect(consoleSessionOutputSchema.safeParse({ ...output, kind: 'agent' }).success).toBe(false);
  });

  it("answers an account's sign-in with the account's id, its token's end and the scopes it carries (accounts design, F1)", () => {
    const account = { ...output, kind: 'account', accountId: 'acc-mathilde', scopes: ['fleet:read'] };

    expect(consoleSessionOutputSchema.parse(account)).toEqual(account);
  });

  it("answers the scopes a plugin declares that the session holds, beside core's, so the plugin checks them (#1234)", () => {
    const account = { ...output, kind: 'account', accountId: 'acc-mathilde', scopes: ['fleet:read', 'trierarch:join'] };

    expect(consoleSessionOutputSchema.parse(account)).toEqual(account);
  });

  it('rejects a scope that is no scope name, and a core scope that does not exist', () => {
    expect(consoleSessionOutputSchema.safeParse({ ...output, scopes: ['trierarch'] }).success).toBe(false);
    expect(consoleSessionOutputSchema.safeParse({ ...output, scopes: ['fleet:fly'] }).success).toBe(false);
  });
});

describe('presentAccountTokenInputSchema', () => {
  it('takes the account token pagasae gave the console', () => {
    expect(presentAccountTokenInputSchema.parse({ token: 'eyJ.a.b' })).toEqual({ token: 'eyJ.a.b' });
  });

  it('refuses an empty token', () => {
    expect(presentAccountTokenInputSchema.safeParse({ token: '' }).success).toBe(false);
  });
});

describe('accountOutputSchema', () => {
  const account = {
    kind: 'operator',
    email: 'operator@example.com',
    theme: 'system',
    hasPassword: true,
    session: { device: 'Mac · Chrome', since: '2026-10-01T08:02:00.000Z' },
  };

  it('takes the email, the theme and this session', () => {
    expect(accountOutputSchema.parse(account)).toEqual(account);
  });

  it('takes the account this session signed in, by its id only, or none (decision 0054)', () => {
    const signedIn = { ...account, session: { ...account.session, accountId: 'acc-mathilde' } };

    expect(accountOutputSchema.parse(signedIn)).toEqual(signedIn);
    expect(accountOutputSchema.parse({ ...account, session: { ...account.session, accountId: null } })).toMatchObject({ session: { accountId: null } });
  });

  it("takes argo's own sign-in with no email yet: fleet:init gives it none (accounts design, A1)", () => {
    expect(accountOutputSchema.parse({ ...account, email: null })).toMatchObject({ kind: 'operator', email: null });
  });

  it('refuses another theme', () => {
    expect(accountOutputSchema.safeParse({ ...account, theme: 'sepia' }).success).toBe(false);
  });

  it('says whether argo has a password, so Settings asks for it before a change', () => {
    expect(accountOutputSchema.parse({ ...account, hasPassword: false })).toMatchObject({ hasPassword: false });
    expect(accountOutputSchema.safeParse({ ...account, hasPassword: 'yes' }).success).toBe(false);
  });

  it('takes an account by its id alone: core keeps no email (decision 0058)', () => {
    expect(accountOutputSchema.parse({ kind: 'account', accountId: 'acc-mathilde' })).toEqual({ kind: 'account', accountId: 'acc-mathilde' });
  });

  it("takes a viewer's session alone, with no email and no theme", () => {
    const viewer = { kind: 'viewer', session: account.session };

    expect(accountOutputSchema.parse(viewer)).toEqual(viewer);
  });
});

describe('setLoginInputSchema', () => {
  const login = { email: 'mathilde@example.com', password: 'a'.repeat(12) };

  it('takes an email and a password of 12 characters, dropping the whitespace around the email', () => {
    expect(setLoginInputSchema.parse({ ...login, email: ' mathilde@example.com ' })).toEqual(login);
  });

  it.each([
    { label: 'an empty email', input: { ...login, email: ' ' }, message: 'Enter your email' },
    { label: 'a password of 11 characters', input: { ...login, password: 'a'.repeat(11) }, message: 'Use a password of at least 12 characters' },
    { label: 'a password of 1025 characters', input: { ...login, password: 'a'.repeat(1025) }, message: 'Use a password of at most 1024 characters' },
  ])('refuses $label, saying why', ({ input, message }) => {
    expect(setLoginInputSchema.safeParse(input).error?.issues[0]?.message).toBe(message);
  });

  it('takes a password of 1024 characters', () => {
    expect(setLoginInputSchema.safeParse({ ...login, password: 'a'.repeat(1024) }).success).toBe(true);
  });

  it('takes the current password exactly as typed, and none while argo has no password', () => {
    expect(setLoginInputSchema.parse({ ...login, currentPassword: ' old horse ' })).toEqual({ ...login, currentPassword: ' old horse ' });
    expect(setLoginInputSchema.parse(login)).toEqual(login);
  });

  it('refuses a current password of 1025 characters', () => {
    expect(setLoginInputSchema.safeParse({ ...login, currentPassword: 'a'.repeat(1025) }).success).toBe(false);
  });
});

describe('setThemeInputSchema', () => {
  it.each(['light', 'dark', 'system'])('takes %s', (theme) => {
    expect(setThemeInputSchema.parse({ theme })).toEqual({ theme });
  });

  it('refuses another theme', () => {
    expect(setThemeInputSchema.safeParse({ theme: 'auto' }).success).toBe(false);
  });
});

describe('redeemSignInTicketInputSchema', () => {
  it('takes the ticket a hosting installation issued', () => {
    expect(redeemSignInTicketInputSchema.parse({ ticket: 'aeolus_st_v1_abc' })).toEqual({ ticket: 'aeolus_st_v1_abc' });
  });

  it.each([
    ['a missing ticket', {}],
    ['an empty ticket', { ticket: '' }],
    ['a ticket over 256 characters', { ticket: 't'.repeat(257) }],
  ])('refuses %s', (_case, input) => {
    expect(redeemSignInTicketInputSchema.safeParse(input).success).toBe(false);
  });
});
