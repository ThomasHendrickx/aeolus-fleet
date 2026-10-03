/**
 * The check-in's messages (docs/squadrons.md, "Check-in"): reserved by
 * convention between squadrons and the aeolus plugin, never by Aeolus.
 */
export const CHECK_IN = 'application/vnd.aeolus.squadron.check-in+json';
export const ROLE = 'application/vnd.aeolus.squadron.role+json';
export const ON_STATION = 'application/vnd.aeolus.squadron.on-station+json';
export const STAND_DOWN = 'application/vnd.aeolus.squadron.stand-down+json';

const MINUTES_PER_HOUR = 60;

/** A check-in interval as the role message says it: `2h` in whole hours, `30m` otherwise. */
export function checkInText(minutes: number): string {
  return minutes % MINUTES_PER_HOUR === 0 ? `${String(minutes / MINUTES_PER_HOUR)}h` : `${String(minutes)}m`;
}
