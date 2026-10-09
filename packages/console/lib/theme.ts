import type { Theme } from '@aeolus-fleet/common';

import { clockTime, shortDateTime } from './relative-time';

export type { Theme };

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

/**
 * The script that sets the theme before the first paint, so the page never
 * flashes the wrong one: the operator's theme, read on the server from their
 * account, or System when signed out. System follows the browser's setting
 * and keeps in step when it changes, for as long as <html> says system.
 */
export function themeScript(theme: Theme): string {
  return `(() => {
  const root = document.documentElement;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => root.classList.toggle('dark', root.dataset.theme === 'dark' || (root.dataset.theme === 'system' && query.matches));
  root.dataset.theme = ${JSON.stringify(theme)};
  apply();
  query.addEventListener('change', apply);
})();`;
}

/** Shows the chosen theme at once, as the script would on the next load. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', isDark);
}
