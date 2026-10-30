import { describe, expect, it } from 'vitest';

import { sealingEntryOf } from './sealing-entry';

describe("the Fleet overview's sealing entry (feature flags design, console mockup)", () => {
  it('is gone for every session while the sealing flag is off', () => {
    expect([sealingEntryOf({ isSealingOn: false, canChangeKeys: true }), sealingEntryOf({ isSealingOn: false, canChangeKeys: false })]).toEqual(['off', 'off']);
  });

  it('is Manage sealing with fleet:keys while the flag is on', () => {
    expect(sealingEntryOf({ isSealingOn: true, canChangeKeys: true })).toBe('manage');
  });

  it('is View sealing without fleet:keys while the flag is on', () => {
    expect(sealingEntryOf({ isSealingOn: true, canChangeKeys: false })).toBe('view');
  });
});
