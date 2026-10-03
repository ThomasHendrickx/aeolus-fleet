/**
 * The flagships at work: one long-poll receive per squadron that is forming
 * or sailing, each delivery handed to the flagship's rule with the squadron
 * as it is stored then. A rescan, every interval and after each forming,
 * starts the receive of a new squadron. A flagship whose lease ended (the
 * operator released it) is no longer watched, and says so in the log.
 */
import { randomUUID } from 'node:crypto';

import type { FleetId } from '@aeolus-fleet/common';
import type { FastifyBaseLogger } from 'fastify';

import type { FleetDoor, ManagementCrewStore } from '../../core/management/ports.js';
import type { HandleFlagshipDelivery } from '../../core/squadron/handle-flagship-delivery.js';
import type { OperatorNotices, SquadronRepository } from '../../core/squadron/ports.js';

/** How long a flagship waits before it receives again after a failure. */
const RETRY_MS = 1_000;

export interface FlagshipWatch {
  /** Starts the receive of every forming or sailing squadron not watched yet. */
  rescan(): Promise<void>;
  stop(): void;
}

export function watchFlagships(deps: {
  door: FleetDoor;
  management: ManagementCrewStore;
  squadrons: SquadronRepository;
  handle: HandleFlagshipDelivery;
  operator: OperatorNotices;
  log: FastifyBaseLogger;
  rescanMs: number;
}): FlagshipWatch {
  const stopping = new AbortController();
  const watched = new Set<string>();
  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      stopping.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });

  const isStopping = (): boolean => stopping.signal.aborted;

  const watch = async (fleetId: FleetId, squadronId: string): Promise<void> => {
    while (!stopping.signal.aborted) {
      const squadron = (await deps.squadrons.list(fleetId)).find((each) => each.id === squadronId);
      if (!squadron || (squadron.state !== 'forming' && squadron.state !== 'sailing')) {
        break;
      }
      try {
        const received = await deps.door.receive(squadron.flagship.crewToken, { signal: stopping.signal });
        if (!received.isOk) {
          if (received.error.code === 'LEASE_ENDED') {
            deps.log.warn({ squadron: squadronId }, 'the flagship was released: squadrons no longer receives on it');
            await deps.operator.tell({
              text: `The flagship of the squadron ${squadronId} was released: squadrons no longer receives on it, so check-ins to it go unanswered.`,
              // Each release is its own notice: a flagship crewed again and released again is told again.
              key: `released-${squadronId}-${randomUUID()}`,
            });
            break;
          }
          deps.log.error({ squadron: squadronId, refusal: received.error }, 'the flagship could not receive');
          await pause(RETRY_MS);
          continue;
        }
        for (const delivery of received.value) {
          const current = (await deps.squadrons.list(fleetId)).find((each) => each.id === squadronId) ?? squadron;
          const handled = await deps.handle(current, delivery);
          if (!handled.isOk) {
            deps.log.error({ squadron: squadronId, refusal: handled.error }, 'the flagship could not handle a delivery');
          }
        }
      } catch (error) {
        if (isStopping()) {
          break;
        }
        deps.log.error({ err: error, squadron: squadronId }, 'the flagship failed to receive');
        await pause(RETRY_MS);
      }
    }
    watched.delete(squadronId);
  };

  const rescan = async (): Promise<void> => {
    const crew = await deps.management.find();
    if (!crew || stopping.signal.aborted) {
      return;
    }
    for (const squadron of await deps.squadrons.list(crew.fleetId)) {
      if ((squadron.state === 'forming' || squadron.state === 'sailing') && !watched.has(squadron.id)) {
        watched.add(squadron.id);
        void watch(crew.fleetId, squadron.id);
      }
    }
  };

  const timer = setInterval(() => void rescan(), deps.rescanMs);
  return {
    rescan,
    stop: () => {
      clearInterval(timer);
      stopping.abort();
    },
  };
}
