import type { ListedShip } from '@aeolus-fleet/common';

import type { ShipInSquadron } from '../../../lib/squadrons-view';

/**
 * Sorting the overview by one of its columns: A to Z, Z to A, then back to
 * the default order. Each column sorts by what it shows, so the order reads
 * as the table does; Seen sorts by time, the most recent first. A ship with
 * nothing in the column goes last either way, and a tie falls back to the
 * ship's name.
 */
export const SORT_COLUMNS = ['ship', 'status', 'report', 'squadronAndLabels', 'runsOn', 'seen'] as const;

export type SortColumn = (typeof SORT_COLUMNS)[number];

export type SortDirection = 'ascending' | 'descending';

export interface FleetSort {
  column: SortColumn;
  direction: SortDirection;
}

export function isSortColumn(value: string | null): value is SortColumn {
  return SORT_COLUMNS.some((column) => column === value);
}

/** The sort after a click on a column's header: A to Z first, then Z to A, then the default order. */
export function nextSort(current: FleetSort | null, column: SortColumn): FleetSort | null {
  if (current?.column !== column) {
    return { column, direction: 'ascending' };
  }
  return current.direction === 'ascending' ? { column, direction: 'descending' } : null;
}

const STATUS_WORDS: Record<ListedShip['status'], string> = { awaitingCrew: 'Awaiting crew', crewed: 'Crewed', retired: 'Retired' };

/** What a column shows for a ship, as text to compare; undefined when the cell is empty. */
function sortValueOf(ship: ListedShip, { column, squadronsOf }: { column: SortColumn; squadronsOf: ReadonlyMap<string, ShipInSquadron> | undefined }): string | undefined {
  switch (column) {
    case 'ship':
      return ship.name;
    case 'status':
      return STATUS_WORDS[ship.status];
    case 'report':
      return (ship.kind === 'agent' || ship.kind === 'plugin') && ship.status === 'crewed' ? (ship.report?.note ?? undefined) : undefined;
    case 'squadronAndLabels': {
      const squadron = squadronsOf?.get(ship.id);
      if (squadron !== undefined && squadron.role !== null) {
        return squadron.squadronId;
      }
      const [first] = ship.labels;
      return first === undefined ? undefined : `${first.key}=${first.value}`;
    }
    case 'runsOn':
      if (ship.status !== 'crewed' || ship.kind === 'viewer') {
        return undefined;
      }
      return ship.kind === 'operator' ? 'console' : (ship.harness ?? undefined);
    case 'seen':
      return ship.lastSeenAt ?? undefined;
  }
}

/** Compares two ships by the sort; Seen compares newest first when ascending, as its "ago" reads. */
export function compareBySort(sort: FleetSort, squadronsOf: ReadonlyMap<string, ShipInSquadron> | undefined): (first: ListedShip, second: ListedShip) => number {
  const sign = (sort.direction === 'ascending' ? 1 : -1) * (sort.column === 'seen' ? -1 : 1);
  return (first, second) => {
    const one = sortValueOf(first, { column: sort.column, squadronsOf });
    const other = sortValueOf(second, { column: sort.column, squadronsOf });
    if (one === undefined || other === undefined) {
      return Number(one === undefined) - Number(other === undefined);
    }
    return sign * one.localeCompare(other, undefined, { sensitivity: 'base' });
  };
}
