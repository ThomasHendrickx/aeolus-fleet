/**
 * Sorting the overview by one of its columns: A to Z, Z to A, then back to
 * the default order. `fleet.list` sorts each column by what it shows, so the
 * order reads as the table does (fleet-list-input).
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
