import { holdLease, type HoldLeaseTx, type LeaseEnded } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { WakeStreams, WakeStreamWatch } from './ports.js';

/** Why a stream is told to look: it opened, a delivery may be pending for it, or the listener listens again. */
export type WakeReason = 'open' | 'notice' | 'reconnect';

/** What a wake stream sends: a wake, a keep-alive, or its end once the lease ended. */
export type WakeStreamItem = { kind: 'wake'; reason: WakeReason } | { kind: 'keepAlive' } | { kind: 'end'; refusal: LeaseEnded };

export type WatchWakeupsRefusal = LeaseEnded | DomainError<'SERVER_STOPPING'>;

export type WatchWakeups = (crew: Crew, closing: AbortSignal) => Promise<Result<AsyncIterable<WakeStreamItem>, WatchWakeupsRefusal>>;

/** How long a stream stays silent before a keep-alive: 25 seconds, so a half-open connection shows within the caller's 60. */
export const KEEP_ALIVE_MS = 25_000;

/**
 * Use case: a crew keeps a wake stream open (`ship.wakeups`, long-poll design
 * W1) and is told to look, with a call that answers at once; the stream never
 * carries a delivery. Its scope (messages:receive) is checked before this runs.
 *
 * It holds the lease, then watches the ship and its type before its first
 * wake (reason `open`), so a delivery that commits while it opens is found by
 * the look that wake starts. Then it wakes once per notice of a delivery
 * pending for the ship or its type, and on `reconnect` when the listener
 * listens again; it sends a keep-alive every 25 seconds without one. At each
 * wake and keep-alive it holds the lease again: an ended one ends the stream
 * with LEASE_ENDED. It closes when the crew closes it or the server stops.
 */
export function createWatchWakeups(deps: {
  uow: UnitOfWork<HoldLeaseTx>;
  wakeStreams: WakeStreams;
  /** The time between keep-alives; 25 seconds unless a test says otherwise. */
  keepAliveMs?: number;
}): WatchWakeups {
  const keepAliveMs = deps.keepAliveMs ?? KEEP_ALIVE_MS;

  async function* stream(crew: Crew, open: { watch: WakeStreamWatch; closing: AbortSignal }): AsyncGenerator<WakeStreamItem> {
    const { watch, closing } = open;
    try {
      yield { kind: 'wake', reason: 'open' };
      for (;;) {
        const outcome = await watch.next(keepAliveMs, closing);
        if (outcome === 'ended') {
          return;
        }
        const held = await deps.uow.run((tx) => holdLease(tx, crew));
        if (!held.isOk) {
          yield { kind: 'end', refusal: held.error };
          return;
        }
        yield outcome === 'timedOut' ? { kind: 'keepAlive' } : { kind: 'wake', reason: outcome };
      }
    } finally {
      watch.stop();
    }
  }

  return async (crew, closing) => {
    const ship = await deps.uow.run((tx) => holdLease(tx, crew));
    if (!ship.isOk) {
      return ship;
    }
    const watch = deps.wakeStreams.open({ fleetId: crew.fleetId, shipId: crew.shipId, type: ship.value.type });
    if (watch === undefined) {
      return refuse('SERVER_STOPPING', 'The server is stopping: open the stream again shortly');
    }
    return ok(stream(crew, { watch, closing }));
  };
}
