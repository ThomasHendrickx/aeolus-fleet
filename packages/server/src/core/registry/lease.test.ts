import { describe, expect, it } from 'vitest';

import { location } from './lease.js';

describe('location', () => {
  it.each(['DEVICE', 'CLOUD', 'SERVER'] as const)('takes %s without a description', (kind) => {
    expect(location(kind)).toEqual({ kind, description: null });
  });

  it.each(['DEVICE', 'CLOUD', 'SERVER'] as const)('refuses a description with %s', (kind) => {
    expect(() => location(kind, 'laptop')).toThrow(/Only an OTHER location carries a description/);
  });

  it('takes OTHER with a trimmed description', () => {
    expect(location('OTHER', '  web console ')).toEqual({ kind: 'OTHER', description: 'web console' });
  });

  it.each([
    ['no description', undefined],
    ['an empty description', ''],
    ['only spaces', '   '],
    ['a description over 100 characters', 'a'.repeat(101)],
  ])('refuses OTHER with %s', (_label, description) => {
    expect(() => location('OTHER', description)).toThrow(/needs a description of 1 to 100 characters/);
  });
});
