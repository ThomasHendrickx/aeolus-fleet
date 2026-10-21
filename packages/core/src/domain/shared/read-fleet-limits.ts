import type { FleetId } from '@aeolus-fleet/common';

import type { Caller } from './caller.js';
import type { Clock } from './clock.js';
import { nextUtcDayStart, utcDayStart } from './utc-day.js';

/** Outbound port: what a fleet's limits apply to, read outside a unit of work. */
export interface FleetLimitReads {
  /** The ship and daily message limits that apply to the fleet now; null where none does. */
  applied(fleetId: FleetId): Promise<{ ships: number | null; dailyMessages: number | null }>;
  /** Its ships that are not retired, argo included. */
  activeShips(fleetId: FleetId): Promise<number>;
  /** The messages it stored at or after `since`, of any kind and from any sender. */
  messagesSince(fleetId: FleetId, since: Date): Promise<number>;
}

export interface FleetLimitsRead {
  ships: { limit: number | null; count: number };
  dailyMessages: { limit: number | null; count: number; resetsAt: Date };
}

export type ReadFleetLimits = (caller: Caller) => Promise<FleetLimitsRead>;

/**
 * Use case: the caller's fleet's ship and daily message limits, with what
 * each counts by the same measures the limits are enforced by: its ships that
 * are not retired, argo included, and the messages it stored since 00:00 UTC,
 * which count again from the next 00:00 UTC. The console shows from it when
 * the fleet is at a limit. The caller's scope (fleet:read) is checked before
 * this runs.
 */
export function createReadFleetLimits(deps: { limits: FleetLimitReads; clock: Clock }): ReadFleetLimits {
  return async ({ fleetId }) => {
    const now = deps.clock.now();
    const [applied, ships, messages] = await Promise.all([
      deps.limits.applied(fleetId),
      deps.limits.activeShips(fleetId),
      deps.limits.messagesSince(fleetId, utcDayStart(now)),
    ]);
    return {
      ships: { limit: applied.ships, count: ships },
      dailyMessages: { limit: applied.dailyMessages, count: messages, resetsAt: nextUtcDayStart(now) },
    };
  };
}
