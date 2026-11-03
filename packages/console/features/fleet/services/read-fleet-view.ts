import { idSchema } from '@aeolus-fleet/common';
import { HARBOUR_STATES, type HarbourState } from '@aeolus-fleet/common/rules';

import { isSortColumn, type FleetSort } from './fleet-sort';
import { DESCENDING, LIST_VIEW, PARAMS, type FleetView } from './fleet-filter';

/** A repeated parameter's values, each once, in the order given; `read` leaves out what it does not know. */
function readAll<T>(values: readonly string[], read: (value: string) => T | undefined): T[] {
  return [...new Set(values)].flatMap((value) => {
    const known = read(value);
    return known === undefined ? [] : [known];
  });
}

function readState(value: string): HarbourState | undefined {
  return HARBOUR_STATES.find((state) => state === value);
}

function readSort(column: string | null, order: string | null): FleetSort | null {
  return isSortColumn(column) ? { column, direction: order === DESCENDING ? 'descending' : 'ascending' } : null;
}

/** Reads the overview's view from the address, on the web app's server (decision 0033); a value it does not know is left out, anything else unknown falls back to the default. */
export function readFleetView(params: URLSearchParams): FleetView {
  return {
    mode: params.get(PARAMS.mode) === LIST_VIEW ? 'list' : 'cards',
    query: params.get(PARAMS.query) ?? '',
    filters: {
      state: readAll(params.getAll(PARAMS.state), readState),
      type: readAll(params.getAll(PARAMS.type), (value) => value),
      labelValueIds: readAll(params.getAll(PARAMS.labelValueIds), (value) => idSchema('labelValue').safeParse(value).data),
    },
    sort: readSort(params.get(PARAMS.sort), params.get(PARAMS.order)),
  };
}
