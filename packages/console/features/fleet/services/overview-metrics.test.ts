import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { needsCrewCountOf, overviewMetrics, overviewSubtitle, type ShipKindCount } from './overview-metrics';

const newId = createIdGenerator();
const NOW = new Date('2026-10-05T12:00:00.000Z');
const MINUTE_MS = 60_000;

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString();
}

function aKindCount(count: Partial<ShipKindCount> & Pick<ShipKindCount, 'kind'>): ShipKindCount {
  return { active: 0, crewed: 0, awaitingCrew: 0, retired: 0, needsCrew: { withTrierarchs: 0, withoutTrierarchs: 0 }, longestWait: null, ...count };
}

const argo = aKindCount({ kind: 'operator', active: 1, crewed: 1 });
const viewer = aKindCount({ kind: 'viewer', active: 1, awaitingCrew: 1 });

describe('overviewMetrics', () => {
  it('counts the active agent ships, crewed and awaiting crew, never argo, the viewer ship or a retired ship', () => {
    const counts = [argo, viewer, aKindCount({ kind: 'agent', active: 2, crewed: 1, awaitingCrew: 1, retired: 1 })];

    expect(overviewMetrics({ counts, now: NOW })).toMatchObject({ activeCount: 2, crewedCount: 1, awaitingCount: 1 });
  });

  it('counts nothing active while argo is alone', () => {
    expect(overviewMetrics({ counts: [argo], now: NOW }).activeCount).toBe(0);
  });

  it('names the ship that has awaited crew longest, and for how long', () => {
    const counts = [aKindCount({ kind: 'agent', active: 2, awaitingCrew: 2, longestWait: { id: newId('ship'), name: 'planner', awaitingCrewSince: minutesAgo(95) } })];

    expect(overviewMetrics({ counts, now: NOW }).longestWait).toEqual({ name: 'planner', wait: '1 h 35 min' });
  });

  it('names no longest wait while every active ship is crewed', () => {
    expect(overviewMetrics({ counts: [aKindCount({ kind: 'agent', active: 1, crewed: 1 })], now: NOW }).longestWait).toBeUndefined();
  });
});

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

describe('overviewSubtitle', () => {
  it('counts the active ships and argo, and the retired ones', () => {
    const counts = [argo, aKindCount({ kind: 'agent', active: 2, crewed: 1, awaitingCrew: 1, retired: 1 })];

    expect(overviewSubtitle({ counts, canCommission: true })).toBe('2 active ships and argo, 1 retired. Changes appear as they happen.');
  });

  it('leaves out retired ships when there are none, and counts one ship as one', () => {
    expect(overviewSubtitle({ counts: [argo, aKindCount({ kind: 'agent', active: 1, crewed: 1 })], canCommission: true })).toBe('1 active ship and argo. Changes appear as they happen.');
  });

  it('says only argo is there yet, and that commissioned ships appear here', () => {
    expect(overviewSubtitle({ counts: [argo], canCommission: true })).toBe('Only argo so far. Ships you commission appear here.');
  });

  it('says only argo is there yet, without commissioning, to a session that cannot commission', () => {
    expect(overviewSubtitle({ counts: [argo, viewer], canCommission: false })).toBe('Only argo so far.');
  });
});
