import { accountOutputSchema, THEMES, type Theme } from '@aeolus-fleet/common';

import { clockTime, shortDateTime } from './relative-time';

export { THEMES, type Theme };

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

/** How long the layout waits for the account before it renders with System. */
const ACCOUNT_TIMEOUT_MS = 1_500;

/**
 * The signed-in operator's theme, asked of the server when the page renders,
 * with the session cookie the browser sent: System when signed out, or when
 * the server does not answer in time.
 */
export async function themeOfSession(serverUrl: string, cookie: string | undefined): Promise<Theme> {
  if (cookie === undefined || cookie === '') {
    return 'system';
  }
  try {
    const response = await fetch(`${serverUrl}/trpc/console.account`, {
      headers: { cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(ACCOUNT_TIMEOUT_MS),
    });
    if (!response.ok) {
      return 'system';
    }
    const body: unknown = await response.json();
    const parsed = accountOutputSchema.safeParse(
      typeof body === 'object' && body !== null && 'result' in body && typeof body.result === 'object' && body.result !== null && 'data' in body.result
        ? body.result.data
        : undefined,
    );
    return parsed.success ? parsed.data.theme : 'system';
  } catch {
    return 'system';
  }
}
