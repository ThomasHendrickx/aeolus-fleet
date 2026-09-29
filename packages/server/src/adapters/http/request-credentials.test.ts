import { describe, expect, it } from 'vitest';

import { clearedSessionCookie, readBearer, readSessionToken, sessionCookie } from './request-credentials.js';

describe('readSessionToken', () => {
  it.each([
    { label: 'the only cookie', header: 'aeolus_session=abc' },
    { label: 'one of several cookies', header: 'theme=dark; aeolus_session=abc; other=1' },
    { label: 'a cookie with spaces around it', header: ' aeolus_session = abc ' },
  ])('reads $label', ({ header }) => {
    expect(readSessionToken(header)).toBe('abc');
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

    expect(sessionCookie({ token: 'abc', expiresAt, now })).toBe(
      'aeolus_session=abc; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Strict',
    );
  });

  it('carries the configured cookie domain, so every host under it receives the cookie', () => {
    const now = new Date('2026-09-29T12:00:00.000Z');
    const expiresAt = new Date('2026-10-29T12:00:00.000Z');

    expect(sessionCookie({ token: 'abc', expiresAt, now, domain: 'fleet.example.com' })).toBe(
      'aeolus_session=abc; Max-Age=2592000; Domain=fleet.example.com; Path=/; HttpOnly; Secure; SameSite=Strict',
    );
  });

  it('never has a negative age', () => {
    const now = new Date('2026-09-29T12:00:00.000Z');

    expect(sessionCookie({ token: 'abc', expiresAt: new Date('2026-09-28T12:00:00.000Z'), now })).toContain(
      'Max-Age=0;',
    );
  });
});

describe('clearedSessionCookie', () => {
  it('removes the cookie with the same attributes', () => {
    expect(clearedSessionCookie()).toBe('aeolus_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict');
  });

  it('removes it for the configured cookie domain', () => {
    expect(clearedSessionCookie('fleet.example.com')).toBe(
      'aeolus_session=; Max-Age=0; Domain=fleet.example.com; Path=/; HttpOnly; Secure; SameSite=Strict',
    );
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
