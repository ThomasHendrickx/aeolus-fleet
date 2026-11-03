import { describe, expect, it } from 'vitest';

import { harbourStateOf } from './harbour.js';

// The state Harbour shows a ship in (docs/design/fleet-overview, "The read Harbour needs"), first match wins.
describe('harbourStateOf', () => {
  it('is alert for a ship with an open alert, whatever its status and report', () => {
    expect([
      harbourStateOf({ status: 'crewed', reportState: 'working', hasOpenAlert: true }),
      harbourStateOf({ status: 'awaitingCrew', reportState: null, hasOpenAlert: true }),
    ]).toEqual(['alert', 'alert']);
  });

  it('is waiting for a ship awaiting crew, or a crewed one that reports blocked', () => {
    expect([
      harbourStateOf({ status: 'awaitingCrew', reportState: null, hasOpenAlert: false }),
      harbourStateOf({ status: 'crewed', reportState: 'blocked', hasOpenAlert: false }),
    ]).toEqual(['waiting', 'waiting']);
  });

  it('is working for a crewed ship that reports working', () => {
    expect(harbourStateOf({ status: 'crewed', reportState: 'working', hasOpenAlert: false })).toBe('working');
  });

  it('is idle for a crewed ship that reports idle, or has not reported yet', () => {
    expect([harbourStateOf({ status: 'crewed', reportState: 'idle', hasOpenAlert: false }), harbourStateOf({ status: 'crewed', reportState: null, hasOpenAlert: false })]).toEqual([
      'idle',
      'idle',
    ]);
  });
});
