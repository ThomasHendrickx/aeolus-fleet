const MINUTE_MS = 60_000;
const MINUTES_IN_HOUR = 60;
const HOURS_IN_DAY = 24;
/** From two days ago a tile counts days; from a week ago it gives the date. */
const DAYS_COUNTED_FROM = 2;
const DAYS_IN_WEEK = 7;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * When a ship last did something, in the words of Harbour's tile, so the
 * console and Bridge say it alike (docs/design/fleet-overview, "The tile"):
 * now, 25 min, 3 h, yesterday, 2 d up to 6 d, then the date (28 Oct); "No
 * activity yet" while it did nothing.
 */
export function lastActivityWordsOf(lastActivityAt: string | null, now: Date): string {
  if (lastActivityAt === null) {
    return 'No activity yet';
  }
  const at = new Date(lastActivityAt);
  const minutes = Math.floor((now.getTime() - at.getTime()) / MINUTE_MS);
  if (minutes < 1) {
    return 'now';
  }
  if (minutes < MINUTES_IN_HOUR) {
    return `${String(minutes)} min`;
  }
  const hours = Math.floor(minutes / MINUTES_IN_HOUR);
  if (hours < HOURS_IN_DAY) {
    return `${String(hours)} h`;
  }
  const days = Math.floor(hours / HOURS_IN_DAY);
  if (days < DAYS_COUNTED_FROM) {
    return 'yesterday';
  }
  return days < DAYS_IN_WEEK ? `${String(days)} d` : `${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ''}`;
}
