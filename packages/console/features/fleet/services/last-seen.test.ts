import { describe, expect, it } from 'vitest';

import { seenSignal } from './last-seen';

const now = new Date('2026-10-04T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('seenSignal', () => {
  it('is fresh under a minute', () => {
    expect(seenSignal(ago(59_000), now)).toBe('fresh');
  });

  it('is a while from one minute to fifteen', () => {
    expect(seenSignal(ago(60_000), now)).toBe('while');
    expect(seenSignal(ago(15 * 60_000), now)).toBe('while');
  });

  it('is long ago after fifteen minutes', () => {
    expect(seenSignal(ago(15 * 60_000 + 1), now)).toBe('long');
  });
});
