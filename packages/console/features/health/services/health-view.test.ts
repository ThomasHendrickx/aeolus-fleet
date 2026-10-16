import { describe, expect, it } from 'vitest';

import { BUILDER, DELIVERING_HEALTH, DOCS_WRITER, HEALTH_NOW, HETZNER, SCOUT, STUCK_HEALTH } from '../../../lib/fixtures/health.fixtures';
import { causeGroupsOf, isStuckCause, marksOf, nextStepOf, stuckByMachine, stuckCount, verdictOf, waitMinutes, waitPosition, type StuckPlace } from './health-view';

function placeOf(predicate: (place: StuckPlace) => boolean): StuckPlace {
  const place = STUCK_HEALTH.stuck.find(predicate);
  if (!place) {
    throw new Error('No such place in the fixture');
  }
  return place;
}

describe('the verdict', () => {
  it('says how many deliveries are stuck in how many places, since the oldest, and how many a day ago', () => {
    expect(verdictOf(STUCK_HEALTH)).toEqual({ kind: 'stuck', count: 9, places: 5, since: '2026-10-14T16:32:00.000Z', dayAgo: 6 });
  });

  it('says delivering when nothing is stuck', () => {
    expect(verdictOf(DELIVERING_HEALTH)).toEqual({ kind: 'delivering' });
  });

  it('counts the stuck deliveries for the navigation', () => {
    expect(stuckCount(STUCK_HEALTH)).toBe(9);
    expect(stuckCount(DELIVERING_HEALTH)).toBe(0);
  });
});

describe('the causes', () => {
  it('lists the causes with anything stuck in their order, each place oldest first', () => {
    expect(causeGroupsOf(STUCK_HEALTH).map((group) => [group.cause, group.count, group.places.length])).toEqual([
      ['noShipCanTake', 2, 1],
      ['waitingForCrew', 3, 1],
      ['stalledInFlight', 3, 2],
      ['undeliverable', 1, 1],
    ]);
    expect(causeGroupsOf(STUCK_HEALTH)[2]?.places.map((place) => place.place.kind === 'ship' && place.place.ship.name)).toEqual(['scout-01', 'builder-02']);
  });

  it('knows a cause from a route segment', () => {
    expect(isStuckCause('stalledInFlight')).toBe(true);
    expect(isStuckCause('notHandled')).toBe(false);
  });
});

describe('the next step of a place', () => {
  it('commissions a ship of the type no ship can take', () => {
    expect(nextStepOf(placeOf((place) => place.cause === 'noShipCanTake'))).toEqual({ label: 'Commission a mapper', href: '/?commission=new' });
  });

  it('gets a starting prompt for a ship awaiting crew, on its page', () => {
    expect(nextStepOf(placeOf((place) => place.cause === 'waitingForCrew'))).toEqual({ label: 'Get starting prompt', href: `/ships/${DOCS_WRITER.id}` });
  });

  it('opens the machine behind a stalled ship, else the ship', () => {
    expect(nextStepOf(placeOf((place) => place.place.kind === 'ship' && place.place.ship.id === BUILDER.id))).toEqual({ label: 'Open machine', href: `/trierarchs/${HETZNER.id}` });
    expect(nextStepOf(placeOf((place) => place.place.kind === 'ship' && place.place.ship.id === SCOUT.id))).toEqual({ label: 'Open ship', href: `/ships/${SCOUT.id}` });
  });

  it('resends or dismisses an undeliverable one on its cause page', () => {
    expect(nextStepOf(placeOf((place) => place.cause === 'undeliverable'))).toEqual({ label: 'Resend or dismiss', href: '/fleet-health/undeliverable' });
  });
});

describe('the marks on the trend', () => {
  it('numbers each place whose oldest wait began in the 7 days, at that hour, oldest first', () => {
    expect(marksOf(STUCK_HEALTH)).toEqual([
      { number: 1, hour: 124, label: 'mapper: no ship can take' },
      { number: 2, hour: 134, label: 'docs-writer: waiting for crew' },
      { number: 3, hour: 134, label: 'scout-01: stalled in flight' },
      { number: 4, hour: 146, label: 'tester-01: undeliverable' },
      { number: 5, hour: 167, label: 'builder-02: stalled in flight' },
    ]);
  });
});

describe('the wait scale', () => {
  it('runs from 1 minute to 7 days, log, clamped at both ends', () => {
    expect(waitPosition(0.5)).toBe(0);
    expect(waitPosition(1)).toBe(0);
    expect(waitPosition(7 * 24 * 60)).toBe(1);
    expect(waitPosition(30 * 24 * 60)).toBe(1);
    expect(waitPosition(60)).toBeCloseTo(Math.log(60) / Math.log(7 * 24 * 60));
  });

  it('measures a wait in minutes up to now', () => {
    expect(waitMinutes('2026-10-16T10:52:00.000Z', HEALTH_NOW)).toBe(40);
  });
});

describe('the machines', () => {
  it('counts the deliveries stuck on the ships each machine crews', () => {
    expect(stuckByMachine(STUCK_HEALTH)).toEqual(new Map([[HETZNER.id, 2]]));
  });
});
