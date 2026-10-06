import { describe, expect, it } from 'vitest';

import { guideViewOf, pathnameOf } from './guide';

const steps = [
  { path: '/', anchor: 'fleet-table', title: 'Your fleet', text: 'Every ship, its type and who crews it.' },
  { path: '/squadrons?tab=blueprints', title: 'Blueprints', text: 'What a squadron is formed from.' },
];

describe('guideViewOf', () => {
  it("shows the session's step while the guide is open, with its place", () => {
    expect(guideViewOf({ steps, progress: { step: 1, state: 'open' } })).toEqual({ step: steps[1], index: 1, total: 2 });
  });

  it.each(['skipped', 'finished'] as const)('shows nothing once the guide is %s', (state) => {
    expect(guideViewOf({ steps, progress: { step: 0, state } })).toBeUndefined();
  });

  it('shows nothing without a guide for the session', () => {
    expect(guideViewOf(null)).toBeUndefined();
    expect(guideViewOf(undefined)).toBeUndefined();
  });
});

describe('pathnameOf', () => {
  it("is a step's page without its query or fragment", () => {
    expect(pathnameOf('/squadrons?tab=blueprints')).toBe('/squadrons');
    expect(pathnameOf('/inbox#latest')).toBe('/inbox');
    expect(pathnameOf('/')).toBe('/');
  });
});
