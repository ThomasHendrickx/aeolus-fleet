import { CREW_STATUSES, idSchema, shipStatusSchema } from '@aeolus-fleet/common';

import { isAgentKind } from './agent-kind';
import { isSortColumn, type FleetSort } from './fleet-sort';
import { DESCENDING, PARAMS, RETIRED_SHOWN, type FleetView, type StatusFilter } from './fleet-filter';
import { crewRequestKeysOf, type CrewRequestKey } from '../../../lib/needs-crew';

/** A repeated parameter's values, each once, in the order given; `read` leaves out what it does not know. */
function readAll<T>(values: readonly string[], read: (value: string) => T | undefined): T[] {
  return [...new Set(values)].flatMap((value) => {
    const known = read(value);
    return known === undefined ? [] : [known];
  });
}

function readStatus(value: string): StatusFilter | undefined {
  const parsed = shipStatusSchema.safeParse(value);
  return parsed.success && parsed.data !== 'retired' ? parsed.data : undefined;
}

function readCrewRequest(value: string): CrewRequestKey | undefined {
  return crewRequestKeysOf(CREW_STATUSES).find((key) => key === value);
}

function readSort(column: string | null, order: string | null): FleetSort | null {
  return isSortColumn(column) ? { column, direction: order === DESCENDING ? 'descending' : 'ascending' } : null;
}

/** Reads the overview's view from the URL, on the web app's server (decision 0033); a value it does not know is left out, anything else unknown falls back to the default. */
export function readFleetView(params: URLSearchParams): FleetView {
  return {
    query: params.get(PARAMS.query) ?? '',
    filters: {
      status: readAll(params.getAll(PARAMS.status), readStatus),
      crewRequest: readAll(params.getAll(PARAMS.crewRequest), readCrewRequest),
      kind: readAll(params.getAll(PARAMS.kind), (value) => (isAgentKind(value) ? value : undefined)),
      type: readAll(params.getAll(PARAMS.type), (value) => value),
      squadron: readAll(params.getAll(PARAMS.squadron), (value) => value),
      isRetiredShown: params.get(PARAMS.isRetiredShown) === RETIRED_SHOWN,
      labelValueIds: params.getAll(PARAMS.labelValueIds).flatMap((value) => idSchema('labelValue').safeParse(value).data ?? []),
    },
    sort: readSort(params.get(PARAMS.sort), params.get(PARAMS.order)),
  };
}
