/**
 * Each fleet's turns (#626): the work that keeps or withdraws a fleet's
 * reach runs one at a time per fleet, in the order it was taken, so a rescan
 * never overlaps another and a switch-off's withdrawal waits for the rescan in
 * flight. Another fleet's work runs meanwhile. A failed turn passes on to the
 * next, and its failure reaches whoever took it.
 */
import type { FleetId } from '@aeolus-fleet/common';

export interface FleetTurns {
  /** Runs the work once every turn taken earlier for the fleet is done. */
  take<T>(fleetId: FleetId, work: () => Promise<T>): Promise<T>;
}

export function createFleetTurns(): FleetTurns {
  // Each fleet's last turn taken, settled either way, so the next waits for it.
  const lastTurns = new Map<FleetId, Promise<void>>();
  const passOn = (): void => undefined;
  return {
    take: (fleetId, work) => {
      const turn = (lastTurns.get(fleetId) ?? Promise.resolve()).then(work);
      const settled = turn.then(passOn, passOn);
      lastTurns.set(fleetId, settled);
      void settled.then(() => {
        if (lastTurns.get(fleetId) === settled) {
          lastTurns.delete(fleetId);
        }
      });
      return turn;
    },
  };
}
