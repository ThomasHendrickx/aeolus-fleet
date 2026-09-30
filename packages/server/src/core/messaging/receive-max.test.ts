import { describe, expect, it } from 'vitest';

import { receiveMax } from './receive-max.js';

describe('receiveMax', () => {
  it('is one when the ship does not say how many', () => {
    expect(receiveMax(undefined)).toEqual({ isOk: true, value: 1 });
  });

  it.each([1, 7, 10])('takes %i: the ship chooses', (max) => {
    expect(receiveMax(max)).toEqual({ isOk: true, value: max });
  });

  it.each([
    ['zero', 0],
    ['eleven', 11],
    ['a fraction', 2.5],
    ['a negative number', -3],
    ['not a number', Number.NaN],
  ])('refuses %s', (_label, max) => {
    expect(receiveMax(max)).toEqual({
      isOk: false,
      error: { kind: 'INVALID_RECEIVE_MAX', message: 'A receive returns 1 to 10 deliveries at once' },
    });
  });
});
