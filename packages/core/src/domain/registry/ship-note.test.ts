import { describe, expect, it } from 'vitest';

import { shipNote } from './ship-note.js';

describe('a ship note', () => {
  it('is none when not given', () => {
    expect(shipNote(undefined)).toEqual({ isOk: true, value: null });
  });

  it('is none when only whitespace', () => {
    expect(shipNote(' \n ')).toEqual({ isOk: true, value: null });
  });

  it('drops whitespace around it', () => {
    expect(shipNote('  reviews pull requests \n')).toEqual({ isOk: true, value: 'reviews pull requests' });
  });

  it('takes 500 characters', () => {
    expect(shipNote('a'.repeat(500))).toEqual({ isOk: true, value: 'a'.repeat(500) });
  });

  it('refuses over 500 characters', () => {
    expect(shipNote('a'.repeat(501))).toEqual({
      isOk: false,
      error: { kind: 'INVALID_SHIP_NOTE', message: 'A note is at most 500 characters' },
    });
  });
});
