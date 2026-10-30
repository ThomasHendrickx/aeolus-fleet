import { describe, expect, it } from 'vitest';

import { payloadSealingOf } from './payload-sealing';

describe('how the console shows a payload in a sealed fleet (decision 0068, N1)', () => {
  it('scenario 25: given a sealed payload core marks unreadable, then it shows the key not reachable in its place', () => {
    expect(payloadSealingOf({ isPayloadSealed: true, isPayloadUnreadable: true })).toBe('keyNotReachable');
  });

  it('given a payload stored sealed, then it shows as today, marked sealed', () => {
    expect(payloadSealingOf({ isPayloadSealed: true, isPayloadUnreadable: false })).toBe('sealed');
  });

  it('given a payload stored before sealing the pass has not sealed yet, then it shows unmarked', () => {
    expect(payloadSealingOf({ isPayloadSealed: false, isPayloadUnreadable: false })).toBe('plain');
  });
});
