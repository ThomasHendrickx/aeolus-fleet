import type { Theme } from '@aeolus-fleet/common';

/**
 * An account's theme, kept in the browser (header design, C5): core stores
 * nothing of an account, so the console keeps the theme an account picks in
 * a cookie of its own, which the root layout reads for the first paint.
 * argo's theme stays on its account on the server.
 */
export const THEME_COOKIE = 'aeolus_console_theme';

const THEME_COOKIE_LIFE_SECONDS = 365 * 24 * 60 * 60;

/** The theme a cookie header names, or System without one the console offers. */
export function themeOfCookies(cookies: string | undefined, themes: readonly Theme[]): Theme {
  const value = cookies
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${THEME_COOKIE}=`))
    ?.slice(THEME_COOKIE.length + 1);
  return themes.find((theme) => theme === value) ?? 'system';
}

/** The cookie that keeps a theme: a year, every console page, and not httpOnly, since the page sets it. */
export function themeCookieOf(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; Max-Age=${String(THEME_COOKIE_LIFE_SECONDS)}; Path=/; SameSite=Lax`;
}
