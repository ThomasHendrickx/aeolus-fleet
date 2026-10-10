import type { FleetId } from '@aeolus-fleet/common';

import type { SupplyFleet, SupplyOutcome } from './supply-fleet.js';

/** What a supply did, or `waiting`: the fleet refused it, and a retry supplies it again. */
export type SupplyState = SupplyOutcome | 'waiting';

export interface Supplies {
  /** Supplies the fleet now, after any supply of it under way: what argo saved last is what it reads. */
  supply(fleetId: FleetId): Promise<SupplyState>;
  /** Supplies again every fleet whose last supply the fleet refused; answers each one it tried. */
  retry(): Promise<{ fleetId: FleetId; state: SupplyState }[]>;
}

/**
 * Policy: the networking plugin supplies each fleet on every change and on
 * reconnect (Thomas on #260), one supply of a fleet at a time, so a slow
 * supply of an older list never lands after a newer one. A supply the fleet
 * refused waits for the next retry; each supply reads what the plugin holds
 * then, so a retry supplies the latest. What waits is kept in memory: a
 * restart supplies every fleet anew.
 */
export function createSupplies(deps: { supplyFleet: SupplyFleet }): Supplies {
  const waiting = new Set<FleetId>();
  const running = new Map<FleetId, Promise<SupplyState>>();

  const supply = (fleetId: FleetId): Promise<SupplyState> => {
    const before = running.get(fleetId) ?? Promise.resolve('supplied');
    const next = before.then(async (): Promise<SupplyState> => {
      const supplied = await deps.supplyFleet(fleetId);
      if (supplied.isOk) {
        waiting.delete(fleetId);
        return supplied.value;
      }
      waiting.add(fleetId);
      return 'waiting';
    });
    running.set(fleetId, next);
    return next;
  };

  return {
    supply,
    retry: async () => {
      const tried: { fleetId: FleetId; state: SupplyState }[] = [];
      for (const fleetId of [...waiting]) {
        tried.push({ fleetId, state: await supply(fleetId) });
      }
      return tried;
    },
  };
}
