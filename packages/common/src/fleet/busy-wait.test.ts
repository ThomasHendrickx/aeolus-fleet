import { describe, expect, it } from 'vitest';

import { busyWaitMs } from './busy-wait.js';

describe('the wait before the next call while the fleet is busy (#610)', () => {
  it('is half of the busy wait at the lowest draw', () => {
    expect(busyWaitMs(4000, () => 0)).toBe(2000);
  });

  it('is all of the busy wait at the highest draw', () => {
    expect(busyWaitMs(4000, () => 1)).toBe(4000);
  });

  it('lies between half and all of the busy wait for a draw in between', () => {
    expect(busyWaitMs(4000, () => 0.25)).toBe(2500);
  });

  it('differs between callers that draw differently, so callers refused together do not call again together', () => {
    expect(busyWaitMs(1000, () => 0.1)).not.toBe(busyWaitMs(1000, () => 0.9));
  });
});
