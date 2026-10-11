import type { ListedShip, UndeliverableDelivery } from '@aeolus-fleet/common';

import { duration } from '../../../lib/relative-time';

/** What the overview's metric cards count (docs/blueprint.md, "Console"). */
export interface OverviewMetrics {
  /** Agent ships that are not retired: argo and the viewer ship are the console's own. */
  activeCount: number;
  crewedCount: number;
  awaitingCount: number;
  /** The ship that has awaited crew longest, and for how long; none while every active ship is crewed. */
  longestWait: { name: string; wait: string } | undefined;
  /** How long the oldest undeliverable delivery has been undeliverable; none without one. */
  oldestUndeliverable: string | undefined;
}

function activeShipsOf(ships: readonly ListedShip[]): ListedShip[] {
  return ships.filter((ship) => ship.kind === 'agent' && ship.status !== 'retired');
}

/** The overview's metrics from the fleet snapshot and Needs attention, at `now`. */
export function overviewMetrics(input: { ships: readonly ListedShip[]; undeliverable: readonly UndeliverableDelivery[]; now: Date }): OverviewMetrics {
  const active = activeShipsOf(input.ships);
  const awaiting = active.filter((ship) => ship.status === 'awaitingCrew');
  const longest = awaiting
    .flatMap((ship) => (ship.awaitingCrewSince === null ? [] : [{ name: ship.name, since: new Date(ship.awaitingCrewSince) }]))
    .sort((first, second) => first.since.getTime() - second.since.getTime())[0];
  const oldest = input.undeliverable
    .map((delivery) => new Date(delivery.since))
    .sort((first, second) => first.getTime() - second.getTime())[0];
  return {
    activeCount: active.length,
    crewedCount: active.filter((ship) => ship.status === 'crewed').length,
    awaitingCount: awaiting.length,
    longestWait: longest && { name: longest.name, wait: duration(longest.since, input.now) },
    oldestUndeliverable: oldest && duration(oldest, input.now),
  };
}

function ships(count: number): string {
  return count === 1 ? '1 active ship' : `${String(count)} active ships`;
}

/** The overview's subtitle: the active ships and argo, and how many are retired; with only argo, what to do next. */
export function overviewSubtitle(input: { ships: readonly ListedShip[]; canCommission: boolean }): string {
  const active = activeShipsOf(input.ships).length;
  const retired = input.ships.filter((ship) => ship.kind === 'agent' && ship.status === 'retired').length;
  if (active === 0 && retired === 0) {
    return input.canCommission ? 'Only argo so far. Ships you commission appear here.' : 'Only argo so far.';
  }
  const retiredWords = retired === 0 ? '' : `, ${String(retired)} retired`;
  return `${ships(active)} and argo${retiredWords}. Changes appear as they happen.`;
}
