import { describe, expect, it } from 'vitest';

import { niceMaxOf } from './usage-axis';

describe('the top of the value axis', () => {
  it.each([
    { tallest: 0, top: 1 },
    { tallest: 0.8, top: 1 },
    { tallest: 1.7, top: 2 },
    { tallest: 2.3, top: 2.5 },
    { tallest: 3_400_000, top: 5_000_000 },
    { tallest: 5_000_001, top: 10_000_000 },
    { tallest: 120, top: 200 },
  ])('is $top for a tallest column of $tallest', ({ tallest, top }) => {
    expect(niceMaxOf(tallest)).toBe(top);
  });
});
