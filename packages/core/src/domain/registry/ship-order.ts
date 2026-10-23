import type { ShipPosition, ShipSortColumn, ShipStatus } from '@aeolus-fleet/common';

import type { ListedShip } from './list-fleet.js';

/**
 * The order of a page of the fleet snapshot (decision 4 of the performance
 * design): by a column, ships with nothing in it last either way, ties by
 * name and then id; without a sort, argo first, then by name. A ship's
 * position in it is where a page after it starts, so a cursor names a place
 * in the order and no offset is read.
 */
export interface ShipSort {
  column: ShipSortColumn;
  direction: 'ascending' | 'descending';
}

const STATUS_WORDS: Record<ShipStatus, string> = { awaitingCrew: 'awaiting crew', crewed: 'crewed', retired: 'retired' };

/** What the column shows for the ship, as text to compare; undefined when the cell is empty. */
function sortValueOf(ship: ListedShip, column: ShipSortColumn): string | undefined {
  switch (column) {
    case 'ship':
      return ship.name;
    case 'status':
      return STATUS_WORDS[ship.status];
    case 'report':
      return (ship.kind === 'agent' || ship.kind === 'plugin') && ship.status === 'crewed' ? (ship.report?.note ?? undefined) : undefined;
    case 'labels': {
      const [first] = ship.labels;
      return first === undefined ? undefined : `${first.key}=${first.value}`;
    }
    case 'runsOn':
      if (ship.status !== 'crewed' || ship.kind === 'viewer') {
        return undefined;
      }
      return ship.kind === 'operator' ? 'console' : (ship.harness ?? undefined);
    case 'seen':
      return ship.lastSeenAt?.toISOString();
  }
}

/** The columns a ship outside read reach shows (decision 0034): its name and status; the others it sorts by as empty. */
export const COLUMNS_SHOWN_OUTSIDE_READ_REACH: readonly ShipSortColumn[] = ['ship', 'status'];

/**
 * The ship's place in the order: whether its value is empty (argo is not,
 * without a sort), the value and its name, in lower case, and its id. A ship
 * outside read reach has no value in a column it does not show, so its place,
 * and a cursor after it, carry nothing it hides.
 */
export function positionOf(ship: ListedShip, { sort, isInReach }: { sort: ShipSort | undefined; isInReach: boolean }): ShipPosition {
  const name = ship.name.toLowerCase();
  if (sort === undefined) {
    return { isEmpty: ship.kind !== 'operator', value: '', name, id: ship.id };
  }
  const isShown = isInReach || COLUMNS_SHOWN_OUTSIDE_READ_REACH.includes(sort.column);
  const value = (isShown ? sortValueOf(ship, sort.column)?.toLowerCase() : undefined) ?? '';
  return { isEmpty: value === '', value, name, id: ship.id };
}

/** Whether the value goes from high to low: Z to A, or Seen ascending, the most recent first, as its "ago" reads. */
export function isValueDescending(sort: ShipSort | undefined): boolean {
  return sort !== undefined && (sort.direction === 'descending') !== (sort.column === 'seen');
}

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

/** Compares two positions in the sort's order. */
export function comparePositions(sort: ShipSort | undefined): (first: ShipPosition, second: ShipPosition) => number {
  const sign = isValueDescending(sort) ? -1 : 1;
  return (first, second) =>
    Number(first.isEmpty) - Number(second.isEmpty) ||
    sign * compareText(first.value, second.value) ||
    compareText(first.name, second.name) ||
    compareText(first.id, second.id);
}
