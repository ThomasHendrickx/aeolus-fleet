import { duration } from '../../../lib/relative-time';
import type { ShipKindCount } from '../../../lib/ship-counts';

/** What the overview's metric cards count (docs/blueprint.md, "Console"). */
export interface OverviewMetrics {
  /** Agent ships that are not retired: argo and the viewer ship are the console's own. */
  activeCount: number;
  crewedCount: number;
  awaitingCount: number;
  /** The ship that has awaited crew longest, and for how long; none while every active ship is crewed. */
  longestWait: { name: string; wait: string } | undefined;
}

function agentsOf(counts: readonly ShipKindCount[]): ShipKindCount | undefined {
  return counts.find((count) => count.kind === 'agent');
}

/** The overview's ship metrics from the ship counts, at `now`. */
export function overviewMetrics(input: { counts: readonly ShipKindCount[]; now: Date }): OverviewMetrics {
  const agents = agentsOf(input.counts);
  const longest = agents?.longestWait ?? null;
  return {
    activeCount: agents?.active ?? 0,
    crewedCount: agents?.crewed ?? 0,
    awaitingCount: agents?.awaitingCrew ?? 0,
    longestWait: longest === null ? undefined : { name: longest.name, wait: duration(new Date(longest.awaitingCrewSince), input.now) },
  };
}

function ships(count: number): string {
  return count === 1 ? '1 active ship' : `${String(count)} active ships`;
}

/** The overview's subtitle: the active ships and argo, and how many are retired; with only argo, what to do next. */
export function overviewSubtitle(input: { counts: readonly ShipKindCount[]; canCommission: boolean }): string {
  const agents = agentsOf(input.counts);
  const active = agents?.active ?? 0;
  const retired = agents?.retired ?? 0;
  if (active === 0 && retired === 0) {
    return input.canCommission ? 'Only argo so far. Ships you commission appear here.' : 'Only argo so far.';
  }
  const retiredWords = retired === 0 ? '' : `, ${String(retired)} retired`;
  return `${ships(active)} and argo${retiredWords}. Changes appear as they happen.`;
}
