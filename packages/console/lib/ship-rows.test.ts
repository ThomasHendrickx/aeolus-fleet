import { createIdGenerator, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { shipRowsOf } from './ship-rows';

const newId = createIdGenerator();

function aShip(ship: Partial<ListedShip>): ListedShip {
  return {
    id: newId('ship'),
    name: 'builder',
    type: 'builder',
    kind: 'agent',
    status: 'crewed',
    startingPrompt: null,
    location: null,
    lastSeenAt: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null, harness: null, model: null, activity: null, awaitingCrewSince: null, crewRequest: null, labels: [], retiredAt: null, ownerShipId: null,
    ...ship,
  };
}

// A ship's live row stays on a view's loaded pages until their refresh
// (lib/live-fleet.ts, #1173); a view shows it only while it matches what the
// view searches or filters for (Thomas, Q3).
describe('shipRowsOf', () => {
  it("shows a live ship that matches the view's search", () => {
    const scout = aShip({ name: 'scout' });

    expect(shipRowsOf([scout, aShip({})], { query: 'sco' })).toEqual([scout]);
  });

  it("hides a live ship the view's search or filters leave out", () => {
    const argo = aShip({ name: 'argo', type: 'operator', kind: 'operator' });

    expect(shipRowsOf([aShip({ name: 'scout', type: 'reviewer' }), argo], { type: ['operator'] })).toEqual([argo]);
  });

  it('hides a retired ship from a view that asks no status: the active ships', () => {
    const argo = aShip({ name: 'argo', type: 'operator', kind: 'operator' });

    expect(shipRowsOf([aShip({ status: 'retired' }), argo], {})).toEqual([argo]);
  });

  it('shows a retired ship on a view that asks the retired ships', () => {
    const castaway = aShip({ name: 'castaway', status: 'retired' });

    expect(shipRowsOf([castaway], { status: ['awaitingCrew', 'crewed', 'retired'] })).toEqual([castaway]);
  });

  it('hides a ship Needs crew does not select', () => {
    const waiting = aShip({ status: 'awaitingCrew', crewRequest: { settingsVersion: 1, requestedAt: '2026-10-24T10:00:00.000Z', assignedTo: null, status: null, reason: null, crewedBy: null, attempt: 0, startedAt: null, givenBack: [] } });

    expect(shipRowsOf([aShip({}), waiting], { needsCrew: 'withoutTrierarchs' })).toEqual([waiting]);
  });

  it('shows each ship once, where it first shows, as a ship put first stays first when Load more brings its page', () => {
    const scout = aShip({ name: 'scout' });
    const builder = aShip({});

    expect(shipRowsOf([scout, builder, scout], {})).toEqual([scout, builder]);
  });

  it('shows no ship outside the read reach', () => {
    expect(shipRowsOf([{ id: newId('ship'), name: 'hidden', type: 'builder', status: 'crewed', isInReadReach: false }], {})).toEqual([]);
  });
});
