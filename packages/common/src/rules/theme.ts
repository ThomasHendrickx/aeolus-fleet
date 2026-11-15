/**
 * One theme per browser, in every Aeolus app (docs/design/header-across-apps.md,
 * T1 and T5): a cookie on the shared domain, not httpOnly, which any app's
 * avatar menu sets and every app's root layout reads for the first paint.
 * Where the apps share no parent domain, each host keeps its own.
 */

/** Light, Dark, or System (the browser's setting), the default. */
export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = 'aeolus_theme';

const THEME_COOKIE_LIFE_SECONDS = 365 * 24 * 60 * 60;

/** The theme a cookie header names, or System when it names none: a new browser starts at System. */
export function themeOfCookies(cookies: string | undefined): Theme {
  const value = cookies
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${THEME_COOKIE}=`))
    ?.slice(THEME_COOKIE.length + 1);
  return THEMES.find((theme) => theme === value) ?? 'system';
}

/** The cookie that keeps a theme a year, on the shared domain when the apps have one, else on this host alone. */
export function themeCookieOf(theme: Theme, sharedDomain: string | undefined): string {
  const domain = sharedDomain === undefined ? '' : `; Domain=${sharedDomain}`;
  return `${THEME_COOKIE}=${theme}${domain}; Max-Age=${String(THEME_COOKIE_LIFE_SECONDS)}; Path=/; SameSite=Lax`;
}
