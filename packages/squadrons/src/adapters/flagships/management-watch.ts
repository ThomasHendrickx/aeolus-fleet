/**
 * squadrons' own ship at work in every fleet it serves (decision 0017): one
 * long-poll receive per connected fleet, each delivery handed to the ship's
 * rule with that fleet's crew as the store holds it then. A rescan, every
 * interval and after connecting, starts the receive of a fleet not watched
 * yet. A fleet squadrons does not serve rests: its receive stops after the
 * current one, and a rescan once it is on again starts it anew. A crew token
 * whose lease ended is dropped by the lease-watching door, so its receive
 * stops and no rescan starts it again until the operator connects again.
 */
import type { FleetId } from '@aeolus-fleet/common';
import type { FastifyBaseLogger } from 'fastify';

import type { IsServed } from '../../core/installation/served.js';
import type { FleetDoor, ManagementCrewStore } from '../../core/management/ports.js';
import type { HandleManagementDelivery } from '../../core/squadron/handle-management-delivery.js';

/** How long the ship waits before it receives again after a failure. */
const RETRY_MS = 1_000;

export interface ManagementWatch {
  /** Starts the receive of every connected fleet it serves and does not watch yet. */
  rescan(): Promise<void>;
  /** Stops receiving, and resolves once every receive and delivery in flight is done: the database may close then. */
  stop(): Promise<void>;
}

export function watchManagementShips(deps: {
  door: FleetDoor;
  management: ManagementCrewStore;
  handle: HandleManagementDelivery;
  isServed: IsServed;
  log: FastifyBaseLogger;
  rescanMs: number;
}): ManagementWatch {
  const stopping = new AbortController();
  // Each watched fleet, by the crew token it receives with: a fleet connected again gets a new one.
  const watched = new Map<FleetId, string>();
  const running = new Set<Promise<void>>();
  const track = (work: Promise<void>): Promise<void> => {
    running.add(work);
    void work.finally(() => running.delete(work));
    return work;
  };
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      stopping.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });

  // A call, not the property: a receive may abort while it waits, which the loop's own check cannot see.
  const isStopping = (): boolean => stopping.signal.aborted;

  const watch = async (fleetId: FleetId, crewToken: string): Promise<void> => {
    while (!stopping.signal.aborted) {
      const crew = await deps.management.find(fleetId);
      if (crew?.crewToken !== crewToken || !(await deps.isServed(fleetId))) {
        break;
      }
      try {
        const received = await deps.door.receive(crewToken, { signal: stopping.signal });
        if (!received.isOk) {
          if (received.error.code === 'LEASE_ENDED') {
            break;
          }
          deps.log.error({ fleet: fleetId, refusal: received.error }, "squadrons' ship could not receive");
          await pause(RETRY_MS);
          continue;
        }
        for (const delivery of received.value) {
          const handled = await deps.handle(crew, delivery);
          if (!handled.isOk) {
            deps.log.error({ fleet: fleetId, refusal: handled.error }, "squadrons' ship could not handle a delivery");
          }
        }
      } catch (error) {
        if (isStopping()) {
          break;
        }
        deps.log.error({ err: error, fleet: fleetId }, "squadrons' ship failed to receive");
        await pause(RETRY_MS);
      }
    }
    if (watched.get(fleetId) === crewToken) {
      watched.delete(fleetId);
    }
  };

  const rescan = async (): Promise<void> => {
    for (const crew of await deps.management.connected()) {
      if (stopping.signal.aborted) {
        return;
      }
      if (watched.get(crew.fleetId) !== crew.crewToken && (await deps.isServed(crew.fleetId))) {
        watched.set(crew.fleetId, crew.crewToken);
        void track(watch(crew.fleetId, crew.crewToken));
      }
    }
  };

  const timer = setInterval(() => void track(rescan()), deps.rescanMs);
  return {
    rescan: () => track(rescan()),
    stop: async () => {
      clearInterval(timer);
      stopping.abort();
      while (running.size > 0) {
        await Promise.allSettled([...running]);
      }
    },
  };
}
