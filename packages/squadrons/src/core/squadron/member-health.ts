import type { FleetShip } from '../management/ports.js';
import type { Member } from './squadron.js';

/** How a member stands (#86, B4): not on station yet, or on time, late or silent by its last report. */
export type MemberHealth = 'not-on-station' | 'on-time' | 'late' | 'silent';

const MINUTE_MS = 60_000;
/** A member is silent after this many check-in intervals without a report (docs/squadrons.md, "Check-in"). */
const SILENT_AFTER_INTERVALS = 3;

/**
 * A member's health, from its ship as the fleet shows it. It is on station
 * only while its ship is crewed and it came on station with that crew: a
 * released or newly crewed member is not on station until it checks in again.
 * Its clock runs from its last report, or from coming on station when it has
 * reported nothing since: late after one check-in interval, silent after three.
 * Observation only: nothing acts on it.
 */
export function memberHealth(
  member: Member,
  reading: { ship: Pick<FleetShip, 'status' | 'crewedSince' | 'reportedAt'>; checkInMinutes: number; now: Date },
): MemberHealth {
  const { ship, checkInMinutes, now } = reading;
  const { onStationAt } = member;
  if (ship.status !== 'crewed' || onStationAt === null || ship.crewedSince === null || onStationAt < ship.crewedSince) {
    return 'not-on-station';
  }
  const since = ship.reportedAt !== null && ship.reportedAt > onStationAt ? ship.reportedAt : onStationAt;
  const elapsed = now.getTime() - since.getTime();
  const interval = checkInMinutes * MINUTE_MS;
  if (elapsed > SILENT_AFTER_INTERVALS * interval) {
    return 'silent';
  }
  return elapsed > interval ? 'late' : 'on-time';
}
