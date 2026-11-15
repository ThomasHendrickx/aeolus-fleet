/**
 * Wakes open wake streams from the notices the delivery listener hears (ADR
 * 0003, decision 0072). Each watches its ship and its type; a notice of a
 * delivery pending for either wakes it, and its crew looks in the database.
 * Held in the server's memory only: a wake is a hint, and a stream's crew
 * still looks at its next wake, reopen or safety look, so nothing the
 * guarantee depends on lives here. No call waits on it.
 */
import type { WakeStreamOutcome, WakeStreams } from '../../domain/messaging/ports.js';
import type { DeliveryNotice } from '../../domain/shared/notifier.js';

export interface ReceiverWakeupHub extends WakeStreams {
  /** Wakes the streams watching the ship or the type the delivery is pending for. */
  deliveryPending: (notice: DeliveryNotice) => void;
  /**
   * Wakes every open stream (reason `reconnect`), so each crew looks again. For when the listener
   * starts listening again: notices sent while it did not listen are gone.
   */
  wakeAll: () => void;
  /** Ends every open stream at once, for a stopping server: no stream opens after. */
  endAll: () => void;
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
  const streams = new Map<string, Set<Stream>>();
  let isEnded = false;

  const everyStream = (): Stream[] => [...new Set([...streams.values()].flatMap((set) => [...set]))];

  return {
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
      for (const stream of streams.get(key) ?? []) {
        wakeStream(stream, 'notice');
      }
    },
    wakeAll: () => {
      for (const stream of everyStream()) {
        wakeStream(stream, 'reconnect');
      }
    },
    endAll: () => {
      isEnded = true;
      for (const stream of everyStream()) {
        stream.settle?.('ended');
      }
    },
  };
}
