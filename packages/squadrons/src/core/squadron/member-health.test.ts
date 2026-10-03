import type { ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { memberHealth } from './member-health.js';
import type { Member } from './squadron.js';

const TESTER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0002';
const MINUTE_MS = 60_000;
const INTERVAL_MINUTES = 30;
const CREWED = new Date('2026-10-03T09:00:00.000Z');
const ON_STATION = new Date('2026-10-03T09:05:00.000Z');

function minutesAfter(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MINUTE_MS);
}

function aTester(onStationAt: Date | null): Member {
  return { shipId: TESTER, name: 'tester-m4p7', role: 'tester', type: 'team-a1b2c3:tester', onStationAt, checkIn: onStationAt && { at: onStationAt, model: null }, standDownMessageId: null, stoodDownAt: null, retiredAt: null };
}

function aCrewedShip(reportedAt: Date | null = null) {
  return { status: 'crewed', crewedSince: CREWED, reportedAt } as const;
}

describe('a member’s health', () => {
  it('is not on station before the member came on station', () => {
    expect(memberHealth(aTester(null), { ship: aCrewedShip(), checkInMinutes: INTERVAL_MINUTES, now: minutesAfter(CREWED, 1) })).toBe('not-on-station');
  });

  it('is not on station while its ship awaits crew, though it was on station before its crew was released', () => {
    const ship = { status: 'awaitingCrew', crewedSince: null, reportedAt: null } as const;
    expect(memberHealth(aTester(ON_STATION), { ship, checkInMinutes: INTERVAL_MINUTES, now: minutesAfter(ON_STATION, 1) })).toBe('not-on-station');
  });

  it('is not on station once a new crew holds its ship, until the member comes on station again', () => {
    const ship = { status: 'crewed', crewedSince: minutesAfter(ON_STATION, 10), reportedAt: null } as const;
    expect(memberHealth(aTester(ON_STATION), { ship, checkInMinutes: INTERVAL_MINUTES, now: minutesAfter(ON_STATION, 11) })).toBe('not-on-station');
  });

  it('is not on station once its ship is retired', () => {
    const ship = { status: 'retired', crewedSince: null, reportedAt: null } as const;
    expect(memberHealth(aTester(ON_STATION), { ship, checkInMinutes: INTERVAL_MINUTES, now: minutesAfter(ON_STATION, 1) })).toBe('not-on-station');
  });

  it('is on time one whole interval after coming on station with no report yet: its clock starts on station', () => {
    expect(memberHealth(aTester(ON_STATION), { ship: aCrewedShip(), checkInMinutes: INTERVAL_MINUTES, now: minutesAfter(ON_STATION, INTERVAL_MINUTES) })).toBe('on-time');
  });

  it('is late just after one interval since coming on station with no report', () => {
    const now = new Date(minutesAfter(ON_STATION, INTERVAL_MINUTES).getTime() + 1);
    expect(memberHealth(aTester(ON_STATION), { ship: aCrewedShip(), checkInMinutes: INTERVAL_MINUTES, now })).toBe('late');
  });

  it('is on time within one interval of its last report', () => {
    const reportedAt = minutesAfter(ON_STATION, 50);
    expect(memberHealth(aTester(ON_STATION), { ship: aCrewedShip(reportedAt), checkInMinutes: INTERVAL_MINUTES, now: minutesAfter(reportedAt, 20) })).toBe('on-time');
  });

  it('counts from coming on station when its last report is older', () => {
    const reportedAt = minutesAfter(ON_STATION, -2);
    expect(memberHealth(aTester(ON_STATION), { ship: aCrewedShip(reportedAt), checkInMinutes: INTERVAL_MINUTES, now: minutesAfter(ON_STATION, 20) })).toBe('on-time');
  });

  it('is still late three whole intervals after its last report', () => {
    const reportedAt = minutesAfter(ON_STATION, 10);
    expect(memberHealth(aTester(ON_STATION), { ship: aCrewedShip(reportedAt), checkInMinutes: INTERVAL_MINUTES, now: minutesAfter(reportedAt, 3 * INTERVAL_MINUTES) })).toBe('late');
  });

  it('is silent just after three intervals since its last report', () => {
    const reportedAt = minutesAfter(ON_STATION, 10);
    const now = new Date(minutesAfter(reportedAt, 3 * INTERVAL_MINUTES).getTime() + 1);
    expect(memberHealth(aTester(ON_STATION), { ship: aCrewedShip(reportedAt), checkInMinutes: INTERVAL_MINUTES, now })).toBe('silent');
  });
});
