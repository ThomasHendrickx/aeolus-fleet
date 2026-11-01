/**
 * Harbour (docs/design/fleet-overview, "The read Harbour needs"): each active
 * ship in one of four states, and the five numbers. The listing computes the
 * state in its statement; this is the rule it is held to.
 */
import type { ReportState, ShipId, ShipKind, ShipStatus } from '@aeolus-fleet/common';

export const HARBOUR_STATES = ['alert', 'waiting', 'working', 'idle'] as const;

export type HarbourState = (typeof HARBOUR_STATES)[number];

/** A ship as Harbour shows it: its tile. */
export interface HarbourShip {
  id: ShipId;
  name: string;
  kind: ShipKind;
  state: HarbourState;
  /** What the ship is doing: its crew's report note; null before it reports, without a note, or while no session crews it. */
  note: string | null;
}

/** Harbour's numbers: the ships it shows, and how many are in each state. */
export type HarbourCounts = { ships: number } & Record<HarbourState, number>;

/**
 * The state of an active ship, first match wins: an open alert is alert;
 * awaiting crew or a blocked report is waiting; a working report is working;
 * anything else (an idle report, or none yet) is idle.
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

/** The numbers over the ships Harbour shows. */
export function harbourCountsOf(ships: readonly Pick<HarbourShip, 'state'>[]): HarbourCounts {
  const counts: HarbourCounts = { ships: ships.length, alert: 0, waiting: 0, working: 0, idle: 0 };
  for (const { state } of ships) {
    counts[state] += 1;
  }
  return counts;
}
