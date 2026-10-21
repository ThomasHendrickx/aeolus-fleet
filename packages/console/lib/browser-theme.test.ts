import { THEMES } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { THEME_COOKIE, themeCookieOf, themeOfCookies } from './browser-theme';

describe("an account's theme, kept in the browser (header design, C5)", () => {
  it('is the theme its cookie names', () => {
    expect(themeOfCookies(`aeolus_account_token=abc; ${THEME_COOKIE}=dark`, THEMES)).toBe('dark');
  });

  it('is System without the cookie, or with a theme the console does not offer', () => {
    expect([themeOfCookies('aeolus_account_token=abc', THEMES), themeOfCookies(`${THEME_COOKIE}=neon`, THEMES), themeOfCookies(undefined, THEMES)]).toEqual(['system', 'system', 'system']);
  });

  it('is kept a year, for every console page, readable by the page that sets it', () => {
    expect(themeCookieOf('light')).toBe(`${THEME_COOKIE}=light; Max-Age=31536000; Path=/; SameSite=Lax`);
  });
});
