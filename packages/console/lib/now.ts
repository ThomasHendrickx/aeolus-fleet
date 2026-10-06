import { useSyncExternalStore } from 'react';

/** Relative times ("6 min ago", "Last seen 20 s ago") move on every ten seconds. */
const TICK_MS = 10_000;

let now = Date.now();
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ticker ??= setInterval(() => {
    now = Date.now();
    for (const notify of listeners) {
      notify();
    }
  }, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(ticker);
      ticker = undefined;
    }
  };
}

function snapshot(): number {
  return now;
}

/** The time relative times are measured from: the clock, read once a minute, shared by every component. */
export function useNow(): Date {
  return new Date(useSyncExternalStore(subscribe, snapshot, snapshot));
}
