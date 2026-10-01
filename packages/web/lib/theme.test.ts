import { describe, expect, it } from 'vitest';

import { sessionSince, THEME_LABELS, THEMES } from './theme';

describe('THEMES', () => {
  it('knows Light, Dark and System, in that order', () => {
    expect(THEMES.map((theme) => THEME_LABELS[theme])).toEqual(['Light', 'Dark', 'System']);
  });
});

describe('sessionSince', () => {
  const now = new Date(2026, 9, 1, 14, 30);

  it('names the device and the time the session began today', () => {
    const since = new Date(2026, 9, 1, 8, 2).toISOString();

    expect(sessionSince({ device: 'Mac · Chrome', since }, now)).toBe('Device · Mac · Chrome, since 08:02');
  });

  it('names the day when the session began on another day', () => {
    const since = new Date(2026, 8, 28, 13, 10).toISOString();

    expect(sessionSince({ device: 'iPhone · Safari', since }, now)).toBe('Device · iPhone · Safari, since 28 Sep, 13:10');
  });
});
