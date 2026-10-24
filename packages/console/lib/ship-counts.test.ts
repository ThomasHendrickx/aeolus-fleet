import { describe, expect, it } from 'vitest';

import { needsCrewCountOf, type ShipKindCount } from './ship-counts';

function aKindCount(count: Partial<ShipKindCount> & Pick<ShipKindCount, 'kind'>): ShipKindCount {
  return { active: 0, crewed: 0, awaitingCrew: 0, retired: 0, needsCrew: { withTrierarchs: 0, withoutTrierarchs: 0 }, longestWait: null, ...count };
}

describe('needsCrewCountOf', () => {
  const counts = [
    aKindCount({ kind: 'agent', needsCrew: { withTrierarchs: 3, withoutTrierarchs: 1 } }),
    aKindCount({ kind: 'person', needsCrew: { withTrierarchs: 1, withoutTrierarchs: 1 } }),
  ];

  it('counts the ships needing crew of every kind, as the trierarch plugin being connected decides', () => {
    expect(needsCrewCountOf(counts, { hasTrierarchs: true })).toBe(4);
  });

  it('counts them as without the trierarch plugin when it is not connected', () => {
    expect(needsCrewCountOf(counts, { hasTrierarchs: false })).toBe(2);
  });
});
