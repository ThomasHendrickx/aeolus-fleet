import type { ShipStatus } from '../fleet/index.js';
import type { ReportState } from '../schemas/report.js';

/**
 * A ship's five states (docs/design/state-colours, "Five states"), in the
 * order Harbour's numbers and each group's tiles show them: alerts first,
 * then awaiting crew, blocked, working and idle. The server works out a
 * ship's state; the browser only groups and orders by it.
 */
export const HARBOUR_STATES = ['alert', 'awaitingCrew', 'blocked', 'working', 'idle'] as const;

export type HarbourState = (typeof HARBOUR_STATES)[number];

/**
 * The state of an active ship, first match wins: an open alert is alert; no
 * session holding the lease is awaiting crew; a blocked report is blocked; a
 * working report is working; anything else (an idle report, or none yet) is
 * idle. Core's statements are
 * held to it, and the fleet snapshot's State filter selects by it.
 */
export function harbourStateOf(ship: { status: Exclude<ShipStatus, 'retired'>; reportState: ReportState | null; hasOpenAlert: boolean }): HarbourState {
  if (ship.hasOpenAlert) {
    return 'alert';
  }
  if (ship.status === 'awaitingCrew') {
    return 'awaitingCrew';
  }
  if (ship.reportState === 'blocked') {
    return 'blocked';
  }
  return ship.reportState === 'working' ? 'working' : 'idle';
}
