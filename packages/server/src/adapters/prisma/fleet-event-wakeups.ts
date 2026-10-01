/**
 * Wakes live subscriptions from the event notices the listener hears
 * (event-log.ts). Each subscription watches its fleet; a notice for it wakes
 * the subscription, which reads the events table again. Held in the server's
 * memory only: a wake-up is a hint and the table is the truth, so a notice
 * lost while the listener reconnects costs nothing once `wakeAll` runs.
 */
import type { FleetId } from '@aeolus-fleet/common';

import type { FleetEventNotice } from '../../core/shared/events.js';

export interface FleetEventWatch {
  /**
   * Settles once the fleet has news: at once when a notice came since the last
   * call. True when woken; false when the signal aborted or the server stops.
   */
  next(signal: AbortSignal): Promise<boolean>;
  stop(): void;
}

export interface FleetEventWakeupHub {
  watch(fleetId: FleetId): FleetEventWatch;
  /** Wakes the subscriptions of the notice's fleet. */
  eventCommitted(notice: FleetEventNotice): void;
  /** Wakes every subscription, so each reads again: for when the listener starts listening again. */
  wakeAll(): void;
  /** Ends every wait and every later one, for a stopping server. */
  endAll(): void;
}

interface Watcher {
  /** News that came while the subscription was not waiting, kept for its next wait. */
  hasNews: boolean;
  settle?: (isWoken: boolean) => void;
}

export function createFleetEventWakeups(): FleetEventWakeupHub {
  const watchers = new Map<FleetId, Set<Watcher>>();
  let isEnded = false;

  const wake = (watcher: Watcher) => {
    if (watcher.settle) {
      watcher.settle(true);
    } else {
      watcher.hasNews = true;
    }
  };

  const every = (): Watcher[] => [...watchers.values()].flatMap((set) => [...set]);

  return {
    watch: (fleetId) => {
      const watcher: Watcher = { hasNews: false };
      const set = watchers.get(fleetId) ?? new Set<Watcher>();
      set.add(watcher);
      watchers.set(fleetId, set);

      return {
        next: (signal) => {
          if (isEnded || signal.aborted) {
            return Promise.resolve(false);
          }
          if (watcher.hasNews) {
            watcher.hasNews = false;
            return Promise.resolve(true);
          }
          return new Promise<boolean>((resolve) => {
            const onAbort = () => {
              watcher.settle?.(false);
            };
            signal.addEventListener('abort', onAbort, { once: true });
            watcher.settle = (isWoken) => {
              signal.removeEventListener('abort', onAbort);
              watcher.settle = undefined;
              resolve(isWoken);
            };
          });
        },
        stop: () => {
          watcher.settle?.(false);
          const watching = watchers.get(fleetId);
          watching?.delete(watcher);
          if (watching?.size === 0) {
            watchers.delete(fleetId);
          }
        },
      };
    },
    eventCommitted: ({ fleetId }) => {
      for (const watcher of watchers.get(fleetId) ?? []) {
        wake(watcher);
      }
    },
    wakeAll: () => {
      for (const watcher of every()) {
        wake(watcher);
      }
    },
    endAll: () => {
      isEnded = true;
      for (const watcher of every()) {
        watcher.settle?.(false);
      }
    },
  };
}
