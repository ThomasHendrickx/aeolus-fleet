/**
 * The networking plugin's ship receiving, in every fleet it is connected to
 * and serves: one long-poll receive after another, each delivery acknowledged
 * and left alone. Receiving keeps its last seen fresh, so the fleet judges the
 * plugin responding while this process runs (decision 0035). A rescan, every
 * interval, starts receiving in a fleet newly connected or switched on; a
 * fleet switched off or no longer connected stops after its current receive.
 */
import type { FleetId } from '@aeolus-fleet/common';
import type { FastifyBaseLogger } from 'fastify';

import type { ConnectionStore } from '../../core/connection/ports.js';
import type { ReceiveOnce } from '../../core/inbox/receive-once.js';
import type { IsServed } from '../../core/installation/served.js';

/** How long a fleet's receiving waits before it receives again after the fleet did not answer. */
const RETRY_MS = 1_000;

export interface InboxWatch {
  /** Starts receiving in every fleet it is connected to and serves, and not receiving in yet. */
  rescan(): Promise<void>;
  /** Stops receiving, and resolves once every receive in flight is done: the database may close then. */
  stop(): Promise<void>;
}

export function watchInboxes(deps: { receiveOnce: ReceiveOnce; connections: ConnectionStore; isServed: IsServed; log: FastifyBaseLogger; rescanMs: number }): InboxWatch {
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
        const received = await deps.receiveOnce(fleetId, { signal: stopping.signal });
        if (!received.isOk) {
          if (received.error.kind === 'NOT_CONNECTED') {
            deps.log.warn({ fleet: fleetId }, 'the networking plugin is no longer connected: it stops receiving there');
            break;
          }
          deps.log.warn({ fleet: fleetId, refusal: received.error }, 'the networking plugin could not receive; it tries again');
          await pause(RETRY_MS);
        }
      } catch (error) {
        if (isStopping()) {
          break;
        }
        deps.log.error({ err: error, fleet: fleetId }, 'the networking plugin failed to receive; it tries again');
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
        deps.log.error({ err: error }, 'the networking plugin failed to rescan its fleets');
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
