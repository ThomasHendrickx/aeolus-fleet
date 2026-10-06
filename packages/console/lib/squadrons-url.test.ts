import { describe, expect, it } from 'vitest';

import { squadronsUrlFrom } from './squadrons-url';

describe('squadronsUrlFrom', () => {
  it('reads AEOLUS_SQUADRONS_URL without a trailing slash', () => {
    expect(squadronsUrlFrom({ AEOLUS_SQUADRONS_URL: 'http://squadrons.internal:4100/' })).toBe('http://squadrons.internal:4100');
  });

  it.each([
    ['unset', {}],
    ['empty', { AEOLUS_SQUADRONS_URL: '' }],
  ])('is undefined when %s: the console has no squadrons', (_label, environment) => {
    expect(squadronsUrlFrom(environment)).toBeUndefined();
  });
});
