import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  THEMES,
  accountOutputSchema,
  consoleSessionOutputSchema,
  redeemSignInTicketInputSchema,
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
  const output = { fleetId: newId('fleet'), expiresAt: '2026-11-01T19:00:00.000Z', kind: 'operator', scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'] };

  it("answers the session's fleet, when it expires, and whose it is: the operator's or a viewer's, with the ship's scopes", () => {
    expect(consoleSessionOutputSchema.parse(output)).toEqual(output);
    expect(consoleSessionOutputSchema.parse({ ...output, kind: 'viewer', scopes: ['fleet:read'] })).toMatchObject({ kind: 'viewer', scopes: ['fleet:read'] });
  });

  it('rejects an expiry that is not ISO 8601', () => {
    expect(consoleSessionOutputSchema.safeParse({ ...output, expiresAt: 'soon' }).success).toBe(false);
  });

  it('rejects an agent: only the operator and a viewer have console sessions', () => {
    expect(consoleSessionOutputSchema.safeParse({ ...output, kind: 'agent' }).success).toBe(false);
  });
});

describe('accountOutputSchema', () => {
  const account = {
    kind: 'operator',
    email: 'operator@example.com',
    theme: 'system',
    session: { device: 'Mac · Chrome', since: '2026-10-01T08:02:00.000Z' },
  };

  it('takes the email, the theme and this session', () => {
    expect(accountOutputSchema.parse(account)).toEqual(account);
  });

  it('refuses another theme', () => {
    expect(accountOutputSchema.safeParse({ ...account, theme: 'sepia' }).success).toBe(false);
  });

  it("takes a viewer's session alone, with no email and no theme", () => {
    const viewer = { kind: 'viewer', session: account.session };

    expect(accountOutputSchema.parse(viewer)).toEqual(viewer);
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
