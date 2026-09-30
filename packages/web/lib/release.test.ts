import { describe, expect, it } from 'vitest';

import { isReleasable } from './release';

describe('isReleasable', () => {
  it('is true for an agent ship a session crews', () => {
    expect(isReleasable({ kind: 'agent', status: 'crewed' })).toBe(true);
  });

  it('is false for a ship awaiting crew: it gets a new starting prompt instead', () => {
    expect(isReleasable({ kind: 'agent', status: 'awaitingCrew' })).toBe(false);
  });

  it('is false for a retired ship', () => {
    expect(isReleasable({ kind: 'agent', status: 'retired' })).toBe(false);
  });

  it('is false for argo, even while the operator crews it', () => {
    expect(isReleasable({ kind: 'operator', status: 'crewed' })).toBe(false);
  });
});
