/**
 * Wakes waiting receives from the notices the delivery listener hears (ADR
 * 0003). Each waiting receive watches its ship and its type; a notice of a
 * delivery pending for either wakes it, and it looks in the database again.
 * Held in the server's memory only: a wake-up is a hint, and a receive that
 * misses one still returns within its wait, so nothing the guarantee depends
 * on lives here.
 */
import type { ReceiverAddress, ReceiverWakeups, ReceiverWatch } from '../../domain/messaging/ports.js';
import type { DeliveryNotice } from '../../domain/shared/notifier.js';

export interface ReceiverWakeupHub extends ReceiverWakeups {
  /** Wakes the receives watching the ship or the type the delivery is pending for. */
  deliveryPending: (notice: DeliveryNotice) => void;
  /**
   * Wakes every waiting receive, so each looks again. For when the listener
   * starts listening again: notices sent while it did not listen are gone.
   */
  wakeAll: () => void;
  /**
   * Ends every wait at once, as if its time had passed, and every later one:
   * for a stopping server, so no receive holds the stop up. Each answers
   * what it would at the end of its wait: no deliveries.
   */
  endAll: () => void;
}

type Outcome = 'woken' | 'timedOut';

interface Watcher {
  /** A wake-up that came while the receive was not waiting, kept for its next wait. */
  isWoken: boolean;
  /** Ends the current wait, if one is running. */
  settle?: (outcome: Outcome) => void;
}

function shipKey(fleetId: string, shipId: string): string {
  return `${fleetId} ship ${shipId}`;
}

function typeKey(fleetId: string, type: string): string {
  return `${fleetId} type ${type}`;
}

export function createReceiverWakeups(): ReceiverWakeupHub {
  const watchers = new Map<string, Set<Watcher>>();
  let isEnded = false;

  const wake = (watcher: Watcher) => {
    if (watcher.settle) {
      watcher.settle('woken');
    } else {
      watcher.isWoken = true;
    }
  };

  const every = (): Watcher[] => [...new Set([...watchers.values()].flatMap((set) => [...set]))];

  return {
    watch: (address: ReceiverAddress): ReceiverWatch => {
      const watcher: Watcher = { isWoken: false };
      const keys = [shipKey(address.fleetId, address.shipId), typeKey(address.fleetId, address.type)];
      for (const key of keys) {
        const set = watchers.get(key) ?? new Set<Watcher>();
        set.add(watcher);
        watchers.set(key, set);
      }

      return {
        next: (waitMs) => {
          if (isEnded) {
            return Promise.resolve('timedOut');
          }
          if (watcher.isWoken) {
            watcher.isWoken = false;
            return Promise.resolve('woken');
          }
          return new Promise<Outcome>((resolve) => {
            const timer = setTimeout(() => {
              watcher.settle?.('timedOut');
            }, waitMs);
            watcher.settle = (outcome) => {
              clearTimeout(timer);
              watcher.settle = undefined;
              resolve(outcome);
            };
          });
        },
        stop: () => {
          watcher.settle?.('timedOut');
          for (const key of keys) {
            const set = watchers.get(key);
            set?.delete(watcher);
            if (set?.size === 0) {
              watchers.delete(key);
            }
          }
        },
      };
    },
    deliveryPending: ({ fleetId, recipient }) => {
      const key = recipient.kind === 'ship' ? shipKey(fleetId, recipient.shipId) : typeKey(fleetId, recipient.type);
      for (const watcher of watchers.get(key) ?? []) {
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
        watcher.settle?.('timedOut');
      }
    },
  };
}
