/**
 * One long-poll call after another, in every fleet the networking plugin is
 * connected to and serves: its ship receiving, each delivery acknowledged and
 * left alone, which keeps its last seen fresh so the fleet judges the plugin
 * responding while this process runs (decision 0035); and its following of
 * the fleet's events, supplying the fleet again when a ship declares its
 * rules (decision 0037). A rescan, every interval, starts in a fleet newly
 * connected or switched on; a fleet switched off or no longer connected stops
 * after its current call.
 */
import type { FleetId } from '@aeolus-fleet/common';
import type { FastifyBaseLogger } from 'fastify';

import type { ConnectionStore } from '../../core/connection/ports.js';
import type { DomainError } from '../../core/shared/errors.js';
import type { Result } from '../../core/shared/result.js';
import type { IsServed } from '../../core/installation/served.js';

/** One long-poll call in a fleet, as receiving and following make it. */
export type FleetCallOnce = (fleetId: FleetId, until: { signal: AbortSignal }) => Promise<Result<unknown, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/** How long a fleet's watch waits before it calls again after the fleet did not answer. */
const RETRY_MS = 1_000;

export interface FleetWatch {
  /** Starts in every fleet it is connected to and serves, and not watched yet. */
  rescan(): Promise<void>;
  /** Stops, and resolves once every call in flight is done: the database may close then. */
  stop(): Promise<void>;
}

export function watchFleets(deps: { once: FleetCallOnce; doing: string; connections: ConnectionStore; isServed: IsServed; log: FastifyBaseLogger; rescanMs: number }): FleetWatch {
  const stopping = new AbortController();
  const watched = new Set<FleetId>();
  const running = new Set<Promise<void>>();
  const track = (work: Promise<void>): void => {
    running.add(work);
    void work.finally(() => running.delete(work));
  };
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      stopping.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });

  const isStopping = (): boolean => stopping.signal.aborted;

  const watch = async (fleetId: FleetId): Promise<void> => {
    while (!isStopping() && (await deps.isServed(fleetId))) {
      try {
        const called = await deps.once(fleetId, { signal: stopping.signal });
        if (!called.isOk) {
          if (called.error.kind === 'NOT_CONNECTED') {
            deps.log.warn({ fleet: fleetId }, `the networking plugin is no longer connected: it stops ${deps.doing} there`);
            break;
          }
          deps.log.warn({ fleet: fleetId, refusal: called.error }, `the networking plugin could not go on ${deps.doing}; it tries again`);
          await pause(RETRY_MS);
        }
      } catch (error) {
        if (isStopping()) {
          break;
        }
        deps.log.error({ err: error, fleet: fleetId }, `the networking plugin failed ${deps.doing}; it tries again`);
        await pause(RETRY_MS);
      }
    }
    watched.delete(fleetId);
  };

  const rescan = async (): Promise<void> => {
    for (const crew of await deps.connections.connected()) {
      if (isStopping() || watched.has(crew.fleetId) || !(await deps.isServed(crew.fleetId))) {
        continue;
      }
      watched.add(crew.fleetId);
      track(watch(crew.fleetId));
    }
  };

  const rescanning = setInterval(() => {
    track(
      rescan().catch((error: unknown) => {
        deps.log.error({ err: error }, `the networking plugin failed to rescan its fleets for ${deps.doing}`);
      }),
    );
  }, deps.rescanMs);

  return {
    rescan,
    stop: async () => {
      clearInterval(rescanning);
      stopping.abort();
      await Promise.all([...running]);
    },
  };
}
