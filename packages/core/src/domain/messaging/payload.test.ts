import { describe, expect, it } from 'vitest';

import { payload } from './payload.js';

describe('a payload', () => {
  it.each([
    { label: 'nothing', text: '' },
    { label: 'exactly 256 KB of one-byte characters', text: 'a'.repeat(262_144) },
    { label: 'exactly 256 KB of three-byte characters and one more byte', text: `${'€'.repeat(87_381)}a` },
  ])('takes $label, exactly as given', ({ text }) => {
    expect(payload(text)).toEqual({ isOk: true, value: text });
  });

  it('keeps whitespace and never parses what it holds', () => {
    expect(payload('  {not json\n')).toEqual({ isOk: true, value: '  {not json\n' });
  });

  it.each([
    { label: 'one-byte characters', text: 'a'.repeat(262_145) },
    { label: 'three-byte characters', text: `${'€'.repeat(87_381)}ab` },
  ])('refuses one byte over 256 KB, counted in UTF-8: $label', ({ text }) => {
    expect(payload(text)).toMatchObject({ isOk: false, error: { kind: 'PAYLOAD_TOO_LARGE' } });
  });
});
