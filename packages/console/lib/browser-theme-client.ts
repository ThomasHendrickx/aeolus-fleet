'use client';

import { themeCookieOf, themeOfCookies, type Theme } from '@aeolus-fleet/common/rules';
import { applyTheme } from '@aeolus-fleet/ui';
import { createContext, useContext, useSyncExternalStore } from 'react';

/**
 * One theme per browser, in every Aeolus app (docs/design/header-across-apps.md,
 * T1 and T2): argo and an account keep it in the theme cookie every app
 * reads, on the domain the apps share, which the root layout hands down.
 */
export const ThemeCookieDomainContext = createContext<string | undefined>(undefined);

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The theme this browser keeps: System on the server, which reads it from the request instead. */
export function useBrowserTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => themeOfCookies(document.cookie),
    () => 'system',
  );
}

/** Keeps a theme in this browser for every Aeolus app and shows it at once. */
export function useKeepBrowserTheme(): (theme: Theme) => void {
  const domain = useContext(ThemeCookieDomainContext);
  return (theme) => {
    document.cookie = themeCookieOf(theme, domain);
    applyTheme(theme);
    for (const listener of listeners) {
      listener();
    }
  };
}
