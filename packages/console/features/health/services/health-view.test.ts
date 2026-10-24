import { describe, expect, it } from 'vitest';

import { BUILDER, DELIVERING_HEALTH, DELIVERING_SUMMARY, DOCS_WRITER, HEALTH_NOW, HETZNER, SCOUT, STUCK_HEALTH, STUCK_SUMMARY } from '../../../lib/fixtures/health.fixtures';
import {
  causeTotalsOf,
  isStuckCause,
  marksOf,
  medianText,
  nextStepOf,
  placeNote,
  stuckByMachine,
  trendSentence,
  verdictOf,
  waitMinutes,
  waitPosition,
  type StuckPlace,
} from './health-view';

function placeOf(predicate: (place: StuckPlace) => boolean): StuckPlace {
  const place = STUCK_HEALTH.stuck.find(predicate);
  if (!place) {
    throw new Error('No such place in the fixture');
  }
  return place;
}

describe('the verdict', () => {
  it('says how many deliveries are stuck in how many places, since the oldest, and how many a day ago', () => {
    expect(verdictOf({ summary: STUCK_SUMMARY, stuckPerHour: STUCK_HEALTH.stuckPerHour })).toEqual({ kind: 'stuck', count: 9, places: 5, since: '2026-10-14T16:32:00.000Z', dayAgo: 6 });
  });

  it('says delivering when nothing is stuck', () => {
    expect(verdictOf({ summary: DELIVERING_SUMMARY, stuckPerHour: DELIVERING_HEALTH.stuckPerHour })).toEqual({ kind: 'delivering' });
  });
});

describe('the causes', () => {
  it('lists the causes with anything stuck in their order, each with how many deliveries in how many places', () => {
    expect(causeTotalsOf(STUCK_SUMMARY)).toEqual([
      { cause: 'noShipCanTake', count: 2, places: 1 },
      { cause: 'waitingForCrew', count: 3, places: 1 },
      { cause: 'stalledInFlight', count: 3, places: 2 },
      { cause: 'undeliverable', count: 1, places: 1 },
    ]);
  });

  it('lists no cause when nothing is stuck', () => {
    expect(causeTotalsOf(DELIVERING_SUMMARY)).toEqual([]);
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
    expect(marksOf({ places: STUCK_HEALTH.stuck, stuckPerHour: STUCK_HEALTH.stuckPerHour })).toEqual([
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
    expect(stuckByMachine(STUCK_SUMMARY)).toEqual(new Map([[HETZNER.id, 2]]));
  });
});

describe('the words around the numbers', () => {
  const fakeDuration = (from: Date, to: Date) => `${String((to.getTime() - from.getTime()) / 60_000)} min`;

  it('says a median under a minute in seconds, else as a duration', () => {
    expect(medianText(6_400, fakeDuration)).toBe('6 s');
    expect(medianText(120_000, fakeDuration)).toBe('2 min');
  });

  it('says whether the stuck count rose or fell since a day ago', () => {
    expect(trendSentence({ kind: 'stuck', count: 9, places: 5, since: '', dayAgo: 6 })).toBe('Up from 6 a day ago.');
    expect(trendSentence({ kind: 'stuck', count: 2, places: 1, since: '', dayAgo: 6 })).toBe('Down from 6 a day ago.');
    expect(trendSentence({ kind: 'stuck', count: 6, places: 1, since: '', dayAgo: 6 })).toBe('As many as a day ago.');
  });

  it('explains a stall by its state and when its session or machine was last seen', () => {
    const since = (at: Date) => `at ${at.toISOString()}`;
    const scout = placeOf((place) => place.place.kind === 'ship' && place.place.ship.id === SCOUT.id);
    const builder = placeOf((place) => place.place.kind === 'ship' && place.place.ship.id === BUILDER.id);

    expect(placeNote(scout, { facts: { lastSeenAt: '2026-10-14T07:31:00.000Z' }, since })).toBe('handed (pulled), session last seen at 2026-10-14T07:31:00.000Z');
    expect(placeNote(builder, { facts: undefined, since })).toBe(`received, machine hetzner-01 last seen at ${HETZNER.lastSeenAt}`);
    expect(placeNote(placeOf((place) => place.cause === 'noShipCanTake'), { facts: undefined, since })).toBeNull();
  });
});
