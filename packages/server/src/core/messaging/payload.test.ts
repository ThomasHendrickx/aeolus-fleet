import { describe, expect, it } from 'vitest';

import { payload } from './payload.js';

describe('a payload', () => {
  it.each([
    { label: 'nothing', text: '' },
    { label: 'exactly 64 KB of one-byte characters', text: 'a'.repeat(65_536) },
    { label: 'exactly 64 KB of three-byte characters and one more byte', text: `${'€'.repeat(21_845)}a` },
  ])('takes $label, exactly as given', ({ text }) => {
    expect(payload(text)).toEqual({ isOk: true, value: text });
  });

  it('keeps whitespace and never parses what it holds', () => {
    expect(payload('  {not json\n')).toEqual({ isOk: true, value: '  {not json\n' });
  });

  it('refuses the character U+0000, which a payload can never hold', () => {
    expect(payload('{"review":"\u0000"}')).toEqual({
      isOk: false,
      error: { kind: 'INVALID_PAYLOAD', message: 'A payload cannot hold the character U+0000 (NUL)' },
    });
  });

  it.each([
    { label: 'one-byte characters', text: 'a'.repeat(65_537) },
    { label: 'three-byte characters', text: `${'€'.repeat(21_845)}ab` },
  ])('refuses one byte over 64 KB, counted in UTF-8: $label', ({ text }) => {
    expect(payload(text)).toMatchObject({ isOk: false, error: { kind: 'PAYLOAD_TOO_LARGE' } });
  });
});
