/**
 * The flagships at work, in every fleet squadrons is connected to: one
 * long-poll receive per squadron that is forming, sailing or standing down, each delivery handed to the flagship's rule with
 * the squadron as it is stored then. A rescan, every interval and after each
 * forming, starts the receive of a new squadron and advances every stand-down,
 * fleet by fleet, then keeps the fleet's squadron labels and declared
 * network rules (#573). Squadrons are told apart by fleet and id: two fleets may
 * each have a squadron of one id. A fleet squadrons does not serve (switched
 * off) rests: its flagships stop receiving after their current receive, and
 * a rescan once it is on again starts them anew; each rescan withdraws its
 * declared rules, which switching it off could not while the fleet did not
 * answer.
 * A flagship whose lease ended (the operator released it) is no longer
 * watched, says so in the log, and argo is told once; one squadrons retired
 * as its squadron disbanded just stops.
 */
import type { FleetId } from '@aeolus-fleet/common';
import type { FastifyBaseLogger } from 'fastify';

import type { FleetDoor, ManagementCrewStore } from '../../core/management/ports.js';
import type { IsServed } from '../../core/installation/served.js';
import type { AdvanceStandDowns } from '../../core/squadron/advance-stand-downs.js';
import type { HandleFlagshipDelivery } from '../../core/squadron/handle-flagship-delivery.js';
import type { OperatorNotices, SquadronRepository } from '../../core/squadron/ports.js';
import type { Squadron } from '../../core/squadron/squadron.js';

/** How long a flagship waits before it receives again after a failure. */
const RETRY_MS = 1_000;

/** Whether a squadron's flagship receives: until its squadron is disbanded. */
function isReceiving(squadron: Squadron | undefined): squadron is Squadron {
  return squadron !== undefined && squadron.state !== 'disbanded';
}

/** What a rescan does for a fleet's reach: keep its labels and declared rules while squadrons serves it, withdraw the rules while it is off. Each logs its own refusals. */
export interface FleetReach {
  keep(fleetId: FleetId): Promise<void>;
  withdraw(fleetId: FleetId): Promise<void>;
}

export interface FlagshipWatch {
  /** Starts the receive of every squadron not disbanded and not watched yet, and advances every stand-down. */
  rescan(): Promise<void>;
  /** Stops receiving, and resolves once every receive, delivery and rescan in flight is done: the database may close then. */
  stop(): Promise<void>;
}

export function watchFlagships(deps: {
  door: FleetDoor;
  management: ManagementCrewStore;
  squadrons: SquadronRepository;
  handle: HandleFlagshipDelivery;
  advanceStandDowns: AdvanceStandDowns;
  isServed: IsServed;
  operator: OperatorNotices;
  reach: FleetReach;
  log: FastifyBaseLogger;
  rescanMs: number;
}): FlagshipWatch {
  const stopping = new AbortController();
  // Squadrons by `<fleet> <id>`.
  const watched = new Set<string>();
  // Squadrons whose flagship's lease ended: a rescan does not receive on them again.
  const ended = new Set<string>();
  const keyOf = (fleetId: FleetId, squadronId: string): string => `${fleetId} ${squadronId}`;
  // What runs in the background, so stop can wait for it.
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

  const isStopping = (): boolean => stopping.signal.aborted;

  // Fleets whose reach a rescan keeps or withdraws now: rescans overlap, and two passes at once would declare twice.
  const reaching = new Set<FleetId>();
  const reachOnce = async (fleetId: FleetId, pass: { work: () => Promise<void>; failure: string }): Promise<void> => {
    if (reaching.has(fleetId)) {
      return;
    }
    reaching.add(fleetId);
    try {
      await pass.work();
    } catch (error) {
      deps.log.error({ err: error, fleet: fleetId }, pass.failure);
    } finally {
      reaching.delete(fleetId);
    }
  };

  const watch = async (fleetId: FleetId, squadronId: string): Promise<void> => {
    while (!stopping.signal.aborted) {
      const squadron = (await deps.squadrons.list(fleetId)).find((each) => each.id === squadronId);
      if (!isReceiving(squadron) || !(await deps.isServed(fleetId))) {
        break;
      }
      try {
        const received = await deps.door.receive(squadron.flagship.crewToken, { signal: stopping.signal });
        if (!received.isOk) {
          if (received.error.code === 'LEASE_ENDED') {
            if (!isReceiving((await deps.squadrons.list(fleetId)).find((each) => each.id === squadronId))) {
              break;
            }
            deps.log.warn({ squadron: squadronId }, 'the flagship was released: squadrons no longer receives on it');
            ended.add(keyOf(fleetId, squadronId));
            await deps.operator.tell({
              fleetId,
              text: `The flagship of the squadron ${squadronId} was released: squadrons no longer receives on it, so check-ins to it go unanswered.`,
              // A released flagship is never crewed again, so one key per squadron tells argo once, across restarts too.
              key: `released-${squadronId}`,
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
    watched.delete(keyOf(fleetId, squadronId));
  };

  const rescanFleet = async (fleetId: FleetId): Promise<void> => {
    for (const squadron of await deps.squadrons.list(fleetId)) {
      const key = keyOf(fleetId, squadron.id);
      if (isReceiving(squadron) && !watched.has(key) && !ended.has(key)) {
        watched.add(key);
        void track(watch(fleetId, squadron.id));
      }
    }
    try {
      await deps.advanceStandDowns(fleetId);
    } catch (error) {
      deps.log.error({ err: error, fleet: fleetId }, 'the stand-downs could not advance');
    }
    await reachOnce(fleetId, { work: () => deps.reach.keep(fleetId), failure: 'the squadron labels and network rules could not be kept' });
  };

  const restFleet = (fleetId: FleetId): Promise<void> => reachOnce(fleetId, { work: () => deps.reach.withdraw(fleetId), failure: 'the network rules could not be withdrawn' });

  const rescan = async (): Promise<void> => {
    for (const crew of await deps.management.connected()) {
      if (stopping.signal.aborted) {
        return;
      }
      if (await deps.isServed(crew.fleetId)) {
        await rescanFleet(crew.fleetId);
      } else {
        await restFleet(crew.fleetId);
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
