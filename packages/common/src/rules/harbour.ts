import type { ShipStatus } from '../fleet/index.js';
import type { ReportState } from '../schemas/report.js';

/**
 * Harbour's four states (docs/design/fleet-overview), in the order its
 * numbers and each group's tiles show them: alerts first, then waiting,
 * working and idle. The server works out a ship's state; the browser only
 * groups and orders by it.
 */
export const HARBOUR_STATES = ['alert', 'waiting', 'working', 'idle'] as const;

export type HarbourState = (typeof HARBOUR_STATES)[number];

/**
 * The state of an active ship, first match wins: an open alert is alert;
 * awaiting crew or a blocked report is waiting; a working report is working;
 * anything else (an idle report, or none yet) is idle. Core's statements are
 * held to it, and the fleet snapshot's State filter selects by it.
 */
export function harbourStateOf(ship: { status: Exclude<ShipStatus, 'retired'>; reportState: ReportState | null; hasOpenAlert: boolean }): HarbourState {
  if (ship.hasOpenAlert) {
    return 'alert';
  }
  if (ship.status === 'awaitingCrew' || ship.reportState === 'blocked') {
    return 'waiting';
  }
  return ship.reportState === 'working' ? 'working' : 'idle';
}
