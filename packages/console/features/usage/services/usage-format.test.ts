import { describe, expect, it } from 'vitest';

import { tokensWords, usdWords } from './usage-format';

describe('the numbers the Usage page shows', () => {
  it.each([
    { tokens: 0, words: '0' },
    { tokens: 950, words: '950' },
    { tokens: 12_400, words: '12 k' },
    { tokens: 1_234_567, words: '1.2 M' },
    { tokens: 3_400_000_000, words: '3.4 B' },
  ])('writes $tokens tokens as $words', ({ tokens, words }) => {
    expect(tokensWords(tokens)).toBe(words);
  });

  it.each([
    { usd: 0, words: '$0.00' },
    { usd: 4.5, words: '$4.50' },
    { usd: 128.4, words: '$128' },
    { usd: 2_450, words: '$2.5k' },
  ])('writes $usd dollars as $words', ({ usd, words }) => {
    expect(usdWords(usd)).toBe(words);
  });
});
