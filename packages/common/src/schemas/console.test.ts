import { describe, expect, it } from 'vitest';

import { signInInputSchema } from './console.js';

describe('signInInputSchema', () => {
  it('accepts a secret', () => {
    expect(signInInputSchema.parse({ secret: 'aeolus_sk_v1_abc' })).toEqual({ secret: 'aeolus_sk_v1_abc' });
  });

  it('drops whitespace around a pasted secret', () => {
    expect(signInInputSchema.parse({ secret: '  aeolus_sk_v1_abc\n' })).toEqual({ secret: 'aeolus_sk_v1_abc' });
  });

  it.each([
    ['a missing secret', {}],
    ['an empty secret', { secret: '' }],
    ['only whitespace', { secret: ' \n ' }],
    ['a secret over 256 characters', { secret: 'a'.repeat(257) }],
  ])('rejects %s', (_label, input) => {
    expect(signInInputSchema.safeParse(input).success).toBe(false);
  });
});
