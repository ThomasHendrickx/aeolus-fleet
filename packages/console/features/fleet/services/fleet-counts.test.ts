import { describe, expect, it } from 'vitest';

import { fleetCountsOf, isOnlyArgoIn, type KindCount } from './fleet-counts';

const FLEET: KindCount[] = [
  { kind: 'operator', active: 1, retired: 0 },
  { kind: 'agent', active: 12, retired: 3 },
  { kind: 'plugin', active: 2, retired: 1 },
];

describe("the overview's counts", () => {
  it('shows the active ships the view selects, of every ship, and the retired ones', () => {
    const view: KindCount[] = [{ kind: 'agent', active: 5, retired: 2 }];

    expect(fleetCountsOf({ view, fleet: FLEET }, { type: ['reviewer'] })).toEqual({ shown: 5, total: 19, retired: 4 });
  });

  it('shows the retired ships the view selects too when its filter asks for them', () => {
    const view: KindCount[] = [{ kind: 'agent', active: 5, retired: 2 }];

    expect(fleetCountsOf({ view, fleet: FLEET }, { status: ['awaitingCrew', 'crewed', 'retired'] }).shown).toBe(7);
  });
});

describe('a fleet of argo alone', () => {
  it('is one with no active ship besides argo, retired ones aside', () => {
    expect([isOnlyArgoIn([{ kind: 'operator', active: 1, retired: 0 }, { kind: 'agent', active: 0, retired: 4 }]), isOnlyArgoIn(FLEET)]).toEqual([true, false]);
  });
});
