import { describe, expect, it } from 'vitest';

import { shipTabOf } from './ship-tab';

describe('the ship page tab a URL opens', () => {
  it('is Messages when the URL says so', () => {
    expect(shipTabOf('messages')).toBe('messages');
  });

  it('is Timeline otherwise', () => {
    expect(shipTabOf(undefined)).toBe('timeline');
    expect(shipTabOf('other')).toBe('timeline');
  });
});
