const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** "14:33": a 24 h clock, in the browser's time zone, for a moment later today. */
export function clockTime(at: Date): string {
  return `${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`;
}

/** "28 Sep, 14:21": day, month and a 24 h clock, in the browser's time zone. */
export function shortDateTime(at: Date): string {
  return `${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ''}, ${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`;
}

/** "28 Sep 2026, 14:05:51": the absolute time a relative one carries in its title. */
export function fullDateTime(at: Date): string {
  return `${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ''} ${String(at.getFullYear())}, ${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}:${twoDigits(at.getSeconds())}`;
}

/**
 * A time as the console words it (docs/design/conventions.md, "Copy"):
 * relative under 24 h ("Just now", "6 min ago", "3 h ago"), otherwise
 * "28 Sep, 14:21".
 */
export function relativeTime(at: Date, now: Date): string {
  const elapsedMs = now.getTime() - at.getTime();
  if (elapsedMs >= DAY_MS || elapsedMs < 0) {
    return shortDateTime(at);
  }
  if (elapsedMs < MINUTE_MS) {
    return 'Just now';
  }
  if (elapsedMs < HOUR_MS) {
    return `${String(Math.floor(elapsedMs / MINUTE_MS))} min ago`;
  }
  return `${String(Math.floor(elapsedMs / HOUR_MS))} h ago`;
}
