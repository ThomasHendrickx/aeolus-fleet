import { describe, expect, it } from 'vitest';

import { shipName, shipType } from './ship-handle.js';

const notAHandle = [
  ['an empty handle', ''],
  ['49 characters', 'a'.repeat(49)],
  ['an uppercase letter', 'Scout'],
  ['a space', 'sea scout'],
  ['spaces around it', ' scout '],
  ['an underscore', 'sea_scout'],
  ['a letter outside a to z', 'zée'],
];

describe('a ship name', () => {
  it.each(['scout', 'reviewer-2', '42', '-'])('takes %j: lowercase letters, digits and hyphens', (name) => {
    expect(shipName(name)).toEqual({ isOk: true, value: name });
  });

  it('takes 48 characters', () => {
    expect(shipName('a'.repeat(48))).toEqual({ isOk: true, value: 'a'.repeat(48) });
  });

  it.each(notAHandle)('refuses %s', (_label, name) => {
    expect(shipName(name)).toEqual({
      isOk: false,
      error: { kind: 'INVALID_SHIP_NAME', message: 'A ship name is 1 to 48 lowercase letters, digits or hyphens' },
    });
  });
});

describe('a ship type', () => {
  it.each(['reviewer', 'code-reviewer', 'v2'])('takes %j, with the same rules as a name', (type) => {
    expect(shipType(type)).toEqual({ isOk: true, value: type });
  });

  it('takes 48 characters', () => {
    expect(shipType('a'.repeat(48))).toEqual({ isOk: true, value: 'a'.repeat(48) });
  });

  it.each(notAHandle)('refuses %s', (_label, type) => {
    expect(shipType(type)).toEqual({
      isOk: false,
      error: { kind: 'INVALID_SHIP_TYPE', message: 'A ship type is 1 to 48 lowercase letters, digits or hyphens' },
    });
  });
});
