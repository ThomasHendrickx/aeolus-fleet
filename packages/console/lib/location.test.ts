import { describe, expect, it } from 'vitest';

import { locationKindWord, locationText } from './location';

describe('locationKindWord', () => {
  it('words a kind in sentence case', () => {
    expect(locationKindWord('OTHER')).toBe('Other');
  });
});

describe('locationText', () => {
  it.each([
    ['DEVICE', 'Device'],
    ['CLOUD', 'Cloud'],
    ['SERVER', 'Server'],
  ] as const)('words %s as %s', (kind, words) => {
    expect(locationText({ location: { kind, description: null } })).toBe(words);
  });

  it('adds the description of an OTHER location after a middle dot', () => {
    expect(locationText({ location: { kind: 'OTHER', description: 'web console' } })).toBe('Other · web console');
  });

  it('has nothing to say while no session crews the ship', () => {
    expect(locationText({ location: null })).toBeNull();
  });
});
