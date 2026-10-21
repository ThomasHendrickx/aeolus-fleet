import { accountOutputSchema, THEMES, type Theme } from '@aeolus-fleet/common';

import { themeOfCookies } from './browser-theme';

/** How long the layout waits for the account before it renders with System. */
const ACCOUNT_TIMEOUT_MS = 1_500;

/**
 * The signed-in operator's theme, asked of the server when the page renders,
 * with the session cookie the browser sent, or an account's, from the
 * browser's theme cookie: System when signed out, or when the server does not
 * answer in time.
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
    if (!parsed.success) {
      return 'system';
    }
    // An account's theme is kept in the browser (header design, C5); a viewer has none: it follows the system (decision 0022).
    switch (parsed.data.kind) {
      case 'operator':
        return parsed.data.theme;
      case 'account':
        return themeOfCookies(cookie, THEMES);
      case 'viewer':
        return 'system';
    }
  } catch {
    return 'system';
  }
}
