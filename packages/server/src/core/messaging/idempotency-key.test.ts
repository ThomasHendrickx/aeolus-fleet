import { describe, expect, it } from 'vitest';

import { idempotencyKey } from './idempotency-key.js';

describe('an idempotency key', () => {
  it.each([
    { label: 'one character', key: 'k' },
    { label: '256 characters', key: 'k'.repeat(256) },
    { label: 'any text, whitespace included', key: ' review pull request 22 ' },
  ])('takes $label, exactly as given', ({ key }) => {
    expect(idempotencyKey(key)).toEqual({ isOk: true, value: key });
  });

  it('refuses the character U+0000', () => {
    expect(idempotencyKey('review\u000022')).toEqual({
      isOk: false,
      error: { kind: 'INVALID_IDEMPOTENCY_KEY', message: 'An idempotency key cannot hold the character U+0000 (NUL)' },
    });
  });

  it.each([
    { label: 'an empty key', key: '' },
    { label: 'a key over 256 characters', key: 'k'.repeat(257) },
  ])('refuses $label', ({ key }) => {
    expect(idempotencyKey(key)).toMatchObject({ isOk: false, error: { kind: 'INVALID_IDEMPOTENCY_KEY' } });
  });
});
