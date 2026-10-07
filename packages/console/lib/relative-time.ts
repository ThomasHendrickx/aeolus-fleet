const SECOND_MS = 1_000;
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

/** "10:20" within a day, "28 Sep, 14:21" once over a day ago: when something began, as "since 10:20". */
export function sinceTime(at: Date, now: Date): string {
  return now.getTime() - at.getTime() < DAY_MS ? clockTime(at) : shortDateTime(at);
}

/** "14:27:40": a 24 h clock to the second, for DeliveryHistory and envelopes. */
export function secondsTime(at: Date): string {
  return `${clockTime(at)}:${twoDigits(at.getSeconds())}`;
}

/** "20 Sep 2026": a date without a time, for when a ship was commissioned. */
export function dayDate(at: Date): string {
  return `${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ''} ${String(at.getFullYear())}`;
}

/** "11 min", "6 h 30 min", "1 d 2 h": how long from one moment to another (docs/design/conventions.md, "Copy"). */
export function duration(from: Date, to: Date): string {
  const elapsedMs = Math.max(0, to.getTime() - from.getTime());
  const days = Math.floor(elapsedMs / DAY_MS);
  const hours = Math.floor((elapsedMs % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((elapsedMs % HOUR_MS) / MINUTE_MS);
  if (days > 0) {
    return hours > 0 ? `${String(days)} d ${String(hours)} h` : `${String(days)} d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${String(hours)} h ${String(minutes)} min` : `${String(hours)} h`;
  }
  return `${String(minutes)} min`;
}

/** "28 Sep": day and month, in the browser's time zone, for a list of commits. */
export function dayMonth(at: Date): string {
  return `${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ''}`;
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

/**
 * When a crewed ship last called the fleet (issue #67): seconds under a
 * minute, so a live session reads "Last seen 20 s ago", then as other
 * relative times.
 */
export function lastSeen(at: Date, now: Date): string {
  const elapsedMs = Math.max(0, now.getTime() - at.getTime());
  return elapsedMs < MINUTE_MS
    ? `Last seen ${String(Math.floor(elapsedMs / SECOND_MS))} s ago`
    : `Last seen ${relativeTime(at, now)}`;
}
