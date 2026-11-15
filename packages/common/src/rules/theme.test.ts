import { describe, expect, it } from 'vitest';

import { THEME_COOKIE, themeCookieOf, themeOfCookies } from './theme.js';

describe('one theme per browser, in every Aeolus app (header-across-apps T1)', () => {
  it('every app reads the theme the browser keeps', () => {
    // Given the browser keeps Dark beside its sign-in cookie
    const cookies = `aeolus_account_token=abc; ${THEME_COOKIE}=dark`;
    // When an app reads the request's cookies
    const theme = themeOfCookies(cookies);
    // Then it shows Dark
    expect(theme).toBe('dark');
  });

  it('a new browser starts at System', () => {
    // Given a browser with no theme cookie, or one naming no theme
    const browsers = [undefined, 'aeolus_account_token=abc', `${THEME_COOKIE}=neon`];
    // When an app reads each
    const themes = browsers.map((cookies) => themeOfCookies(cookies));
    // Then each is System
    expect(themes).toEqual(['system', 'system', 'system']);
  });

  it('the theme is kept a year on the shared domain, readable by the page that sets it', () => {
    // Given the apps share the parent domain aeolus-fleet.dev
    const sharedDomain = 'aeolus-fleet.dev';
    // When the avatar menu keeps Light
    const cookie = themeCookieOf('light', sharedDomain);
    // Then every app on that domain reads it, and it is not httpOnly
    expect(cookie).toBe(`${THEME_COOKIE}=light; Domain=aeolus-fleet.dev; Max-Age=31536000; Path=/; SameSite=Lax`);
  });

  it('apps on hosts that share no parent domain each keep their own', () => {
    // Given a self-hosted app with no shared domain
    const sharedDomain = undefined;
    // When the avatar menu keeps Dark
    const cookie = themeCookieOf('dark', sharedDomain);
    // Then the cookie is the host's alone
    expect(cookie).toBe(`${THEME_COOKIE}=dark; Max-Age=31536000; Path=/; SameSite=Lax`);
  });
});
