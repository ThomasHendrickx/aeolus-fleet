/**
 * Harbour (docs/design/fleet-overview, "The read Harbour needs"): each active
 * ship in one of four states (common's harbourStateOf), and the five
 * numbers.
 */
import type { ShipId, ShipKind } from '@aeolus-fleet/common';
import type { HarbourState } from '@aeolus-fleet/common/rules';

/** A ship as Harbour shows it: its tile. */
export interface HarbourShip {
  id: ShipId;
  name: string;
  kind: ShipKind;
  state: HarbourState;
  /** What the ship is doing: its crew's report note; null before it reports, without a note, or while no session crews it. */
  note: string | null;
  /** When the ship last did something: the latest of its sends, its acknowledgements and the activity its trierarch reported; null before any. */
  lastActivityAt: Date | null;
}

/** Harbour's numbers: the ships it shows, and how many are in each state. */
export type HarbourCounts = { ships: number } & Record<HarbourState, number>;

/** The latest of the times given, none when there is none. */
export function latestOf(times: readonly (Date | null)[]): Date | null {
  return times.reduce<Date | null>((latest, time) => (time !== null && (latest === null || time > latest) ? time : latest), null);
}

/** The numbers over the ships Harbour shows. */
export function harbourCountsOf(ships: readonly Pick<HarbourShip, 'state'>[]): HarbourCounts {
  const counts: HarbourCounts = { ships: ships.length, alert: 0, waiting: 0, working: 0, idle: 0 };
  for (const { state } of ships) {
    counts[state] += 1;
  }
  return counts;
}
