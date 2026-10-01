import { useSyncExternalStore } from 'react';

/**
 * Whether a moment has passed, and a render once it does: for a button that
 * waits until a rate limit allows another try. No moment has always passed.
 */
export function useHasPassed(at: Date | undefined): boolean {
  const atMs = at?.getTime();
  return useSyncExternalStore(
    (notify) => {
      if (atMs === undefined) {
        return () => undefined;
      }
      const timer = setTimeout(notify, Math.max(0, atMs - Date.now()));
      return () => {
        clearTimeout(timer);
      };
    },
    () => atMs === undefined || Date.now() >= atMs,
    () => true,
  );
}
