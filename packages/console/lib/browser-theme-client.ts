'use client';

import type { Theme } from '@aeolus-fleet/common';
import { useSyncExternalStore } from 'react';

import { themeCookieOf, themeOfCookies } from './browser-theme';
import { applyTheme } from './theme';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The theme this browser keeps for an account (lib/browser-theme.ts): System on the server, which reads it from the request instead. */
export function useBrowserTheme(themes: readonly Theme[]): Theme {
  return useSyncExternalStore(
    subscribe,
    () => themeOfCookies(document.cookie, themes),
    () => 'system',
  );
}

/** Keeps the theme in this browser and applies it at once. */
export function keepBrowserTheme(theme: Theme): void {
  document.cookie = themeCookieOf(theme);
  applyTheme(theme);
  for (const listener of listeners) {
    listener();
  }
}
