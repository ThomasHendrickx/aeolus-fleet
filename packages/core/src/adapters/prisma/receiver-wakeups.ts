/**
 * Wakes waiting receives and open wake streams from the notices the delivery
 * listener hears (ADR 0003). Each watches its ship and its type; a notice of a
 * delivery pending for either wakes it, and it looks in the database again.
 * Held in the server's memory only: a wake-up is a hint, and a receive that
 * misses one still returns within its wait, as a stream's crew still looks at
 * its next wake, reopen or safety look, so nothing the guarantee depends on
 * lives here.
 */
import type { ReceiverAddress, ReceiverWakeups, ReceiverWatch, WakeStreamOutcome, WakeStreams } from '../../domain/messaging/ports.js';
import type { DeliveryNotice } from '../../domain/shared/notifier.js';
import { measureWait } from '../telemetry/calls.js';

export interface ReceiverWakeupHub extends ReceiverWakeups, WakeStreams {
  /** Wakes the receives and streams watching the ship or the type the delivery is pending for. */
  deliveryPending: (notice: DeliveryNotice) => void;
  /**
   * Wakes every waiting receive and every open stream (reason `reconnect`), so each looks again. For when the listener
   * starts listening again: notices sent while it did not listen are gone.
   */
  wakeAll: () => void;
  /**
   * Ends every wait at once, as if its time had passed, and every later one:
   * for a stopping server, so no receive holds the stop up. Each answers
   * what it would at the end of its wait: no deliveries. Every open stream
   * ends too, and no stream opens after.
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

/** An open wake stream: each wake that came while it was not waiting, kept in order for its next waits. */
interface Stream {
  kept: ('notice' | 'reconnect')[];
  settle?: (outcome: WakeStreamOutcome) => void;
}

/** Each notice wakes a stream once (long-poll design, W1): what comes while it is not waiting is kept, never merged. */
function wakeStream(stream: Stream, reason: 'notice' | 'reconnect'): void {
  if (stream.settle) {
    stream.settle(reason);
  } else {
    stream.kept.push(reason);
  }
}

function shipKey(fleetId: string, shipId: string): string {
  return `${fleetId} ship ${shipId}`;
}

function typeKey(fleetId: string, type: string): string {
  return `${fleetId} type ${type}`;
}

export function createReceiverWakeups(): ReceiverWakeupHub {
  const watchers = new Map<string, Set<Watcher>>();
  const streams = new Map<string, Set<Stream>>();
  let isEnded = false;

  const wake = (watcher: Watcher) => {
    if (watcher.settle) {
      watcher.settle('woken');
    } else {
      watcher.isWoken = true;
    }
  };

  const every = (): Watcher[] => [...new Set([...watchers.values()].flatMap((set) => [...set]))];
  const everyStream = (): Stream[] => [...new Set([...streams.values()].flatMap((set) => [...set]))];

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
          return measureWait(
            () =>
              new Promise<Outcome>((resolve) => {
                const timer = setTimeout(() => {
                  watcher.settle?.('timedOut');
                }, waitMs);
                watcher.settle = (outcome) => {
                  clearTimeout(timer);
                  watcher.settle = undefined;
                  resolve(outcome);
                };
              }),
          );
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
    open: (address) => {
      if (isEnded) {
        return undefined;
      }
      const stream: Stream = { kept: [] };
      const keys = [shipKey(address.fleetId, address.shipId), typeKey(address.fleetId, address.type)];
      for (const key of keys) {
        const set = streams.get(key) ?? new Set<Stream>();
        set.add(stream);
        streams.set(key, set);
      }

      return {
        next: (waitMs, signal) => {
          if (isEnded || signal.aborted) {
            return Promise.resolve('ended');
          }
          const kept = stream.kept.shift();
          if (kept !== undefined) {
            return Promise.resolve(kept);
          }
          return new Promise<WakeStreamOutcome>((resolve) => {
            const onAbort = () => {
              stream.settle?.('ended');
            };
            const timer = setTimeout(() => {
              stream.settle?.('timedOut');
            }, waitMs);
            signal.addEventListener('abort', onAbort, { once: true });
            stream.settle = (outcome) => {
              clearTimeout(timer);
              signal.removeEventListener('abort', onAbort);
              stream.settle = undefined;
              resolve(outcome);
            };
          });
        },
        stop: () => {
          stream.settle?.('ended');
          for (const key of keys) {
            const set = streams.get(key);
            set?.delete(stream);
            if (set?.size === 0) {
              streams.delete(key);
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
      for (const stream of streams.get(key) ?? []) {
        wakeStream(stream, 'notice');
      }
    },
    wakeAll: () => {
      for (const watcher of every()) {
        wake(watcher);
      }
      for (const stream of everyStream()) {
        wakeStream(stream, 'reconnect');
      }
    },
    endAll: () => {
      isEnded = true;
      for (const watcher of every()) {
        watcher.settle?.('timedOut');
      }
      for (const stream of everyStream()) {
        stream.settle?.('ended');
      }
    },
  };
}
