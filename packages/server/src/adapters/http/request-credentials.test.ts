import { describe, expect, it } from 'vitest';

import { clearedSessionCookie, readBearer, readSessionToken, sessionCookie } from './request-credentials.js';

describe('readSessionToken', () => {
  it.each([
    ['the only cookie', 'aeolus_session=abc', 'abc'],
    ['one of several cookies', 'theme=dark; aeolus_session=abc; other=1', 'abc'],
    ['a cookie with spaces around it', ' aeolus_session = abc ', 'abc'],
  ])('reads %s', (_label, header, token) => {
    expect(readSessionToken(header)).toBe(token);
  });

  it.each([
    ['no header', undefined],
    ['other cookies only', 'theme=dark; my_aeolus_session=abc'],
    ['an empty value', 'aeolus_session='],
  ])('finds nothing with %s', (_label, header) => {
    expect(readSessionToken(header)).toBeUndefined();
  });
});

describe('sessionCookie', () => {
  it('lives until the session expires, in whole seconds', () => {
    const now = new Date('2026-09-29T12:00:00.000Z');
    const expiresAt = new Date('2026-10-29T12:00:00.500Z');

    expect(sessionCookie('abc', expiresAt, now)).toBe(
      'aeolus_session=abc; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Strict',
    );
  });

  it('never has a negative age', () => {
    const now = new Date('2026-09-29T12:00:00.000Z');

    expect(sessionCookie('abc', new Date('2026-09-28T12:00:00.000Z'), now)).toContain('Max-Age=0;');
  });
});

describe('clearedSessionCookie', () => {
  it('removes the cookie with the same attributes', () => {
    expect(clearedSessionCookie()).toBe('aeolus_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict');
  });
});

describe('readBearer', () => {
  it.each([
    ['Bearer aeolus_sk_v1_abc', 'aeolus_sk_v1_abc'],
    ['bearer aeolus_sk_v1_abc', 'aeolus_sk_v1_abc'],
    ['Bearer   aeolus_sk_v1_abc  ', 'aeolus_sk_v1_abc'],
  ])('reads %j', (header, secret) => {
    expect(readBearer(header)).toBe(secret);
  });

  it.each([undefined, '', 'Basic abc', 'Bearer', 'Bearer a b'])('finds nothing in %j', (header) => {
    expect(readBearer(header)).toBeUndefined();
  });
});
