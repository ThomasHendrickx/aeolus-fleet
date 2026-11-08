import { describe, expect, it } from 'vitest';

import { crewRequestReasonMessageSchema } from './crew-request-reason.js';

// The examples follow the trierarch plugin's docs/design/enabled-models-for-ships.md, R4.

const A_REASON = { shipId: 'shp_01m473j7hp3x6gha0gzs1mnf88', shipName: 'scout', settingsVersion: 3, reason: 'model not available: gpt-5.6-terra' };

describe('crewRequestReasonMessageSchema', () => {
  it('takes the ship, its settings version and the reason', () => {
    expect(crewRequestReasonMessageSchema.safeParse(A_REASON)).toEqual({ success: true, data: A_REASON });
  });

  it('takes the give-back reason', () => {
    const givenBack = { ...A_REASON, reason: 'given back by every trierarch that fits; last: the worktree could not be made' };

    expect(crewRequestReasonMessageSchema.safeParse(givenBack)).toEqual({ success: true, data: givenBack });
  });

  it.each([
    ['a ship id that is no ship id', { ...A_REASON, shipId: 'msg_01m473j7hp3x6gha0gzs1mnf88' }],
    ['no ship name', { ...A_REASON, shipName: '' }],
    ['a settings version of 0', { ...A_REASON, settingsVersion: 0 }],
    ['an empty reason', { ...A_REASON, reason: '' }],
    ['a reason of two lines', { ...A_REASON, reason: 'model not available:\ngpt-5.6-terra' }],
    ['a reason over 200 characters', { ...A_REASON, reason: 'x'.repeat(201) }],
    ['an unknown field', { ...A_REASON, kind: 'model' }],
  ])('refuses %s', (_name, message) => {
    expect(crewRequestReasonMessageSchema.safeParse(message).success).toBe(false);
  });
});
