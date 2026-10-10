import { describe, expect, it } from 'vitest';

import { secondsProblem, WHILE_UNAVAILABLE_WORDS } from './network-declaration';

const BOUNDS = { min: 60, max: 86_400 };

describe('after how long the networking plugin is not responding, as argo types it (decision 0035)', () => {
  it.each(['60', '300', '86400'])('takes %s seconds, within the bounds', (text) => {
    expect(secondsProblem(text, BOUNDS)).toBeUndefined();
  });

  it.each([
    ['59', 'At least 60 seconds.'],
    ['86401', 'At most 86400 seconds.'],
    ['', 'A whole number of seconds.'],
    ['90.5', 'A whole number of seconds.'],
    ['ten', 'A whole number of seconds.'],
  ])('refuses %j: %s', (text, problem) => {
    expect(secondsProblem(text, BOUNDS)).toBe(problem);
  });
});

describe('what each declaration means', () => {
  it('names block-all, open-all and keep-latest as the operator reads them', () => {
    expect(Object.keys(WHILE_UNAVAILABLE_WORDS)).toEqual(['block-all', 'open-all', 'keep-latest']);
  });
});
