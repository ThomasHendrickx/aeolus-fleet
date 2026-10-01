import { clockTime, shortDateTime } from './relative-time';

/** How the console looks: light, dark, or following the system setting. */
export type Theme = 'light' | 'dark' | 'system';

export const THEMES: readonly Theme[] = ['light', 'dark', 'system'];

export const THEME_LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };

/** Whether two moments fall on the same day, in the browser's time zone. */
function isSameDay(first: Date, second: Date): boolean {
  return first.toDateString() === second.toDateString();
}

/**
 * The account menu's session line (docs/design/png/AccountMenu.png): "Device ·
 * Mac · Chrome, since 08:02", or since a short date when the session began on
 * another day.
 */
export function sessionSince(session: { device: string; since: string }, now: Date): string {
  const since = new Date(session.since);
  const when = isSameDay(since, now) ? clockTime(since) : shortDateTime(since);
  return `Device · ${session.device}, since ${when}`;
}
