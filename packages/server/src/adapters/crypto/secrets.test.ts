import { describe, expect, it } from 'vitest';

import { cryptoRandomTokens, sha256Hasher } from './secrets.js';

describe('sha256Hasher', () => {
  it('gives the SHA-256 of the value in hex', () => {
    expect(sha256Hasher.hash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('cryptoRandomTokens', () => {
  it('gives 43 URL-safe characters: 256 bits', () => {
    expect(cryptoRandomTokens.next()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 1_000 }, () => cryptoRandomTokens.next()));

    expect(tokens.size).toBe(1_000);
  });
});
