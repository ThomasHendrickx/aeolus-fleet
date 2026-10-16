import { useSyncExternalStore } from 'react';

const noSubscription = () => () => undefined;

/**
 * Whether the browser treats this page as a secure context (https, or
 * localhost), where it keeps the Secure session cookie. True on the server and
 * before hydration, so the server HTML never warns.
 */
export function useIsSecureContext(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => window.isSecureContext,
    () => true,
  );
}
