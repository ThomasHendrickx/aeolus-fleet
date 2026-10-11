import { CREW_STATUSES, idSchema, shipStatusSchema } from '@aeolus-fleet/common';

import { PARAMS, RETIRED_SHOWN, type FleetFilters, type FleetView } from './fleet-filter';
import { crewRequestKeysOf } from '../../../lib/needs-crew';

function readStatus(value: string | null): FleetFilters['status'] {
  const parsed = shipStatusSchema.safeParse(value);
  return parsed.success && parsed.data !== 'retired' ? parsed.data : 'all';
}

function readCrewRequest(value: string | null): FleetFilters['crewRequest'] {
  return crewRequestKeysOf(CREW_STATUSES).find((key) => key === value) ?? 'all';
}

/** Reads the overview's view from the URL, on the web app's server (decision 0033); anything unknown falls back to the default. */
export function readFleetView(params: URLSearchParams): FleetView {
  return {
    query: params.get(PARAMS.query) ?? '',
    filters: {
      status: readStatus(params.get(PARAMS.status)),
      crewRequest: readCrewRequest(params.get(PARAMS.crewRequest)),
      type: params.get(PARAMS.type) ?? 'all',
      squadron: params.get(PARAMS.squadron) ?? 'all',
      isRetiredShown: params.get(PARAMS.isRetiredShown) === RETIRED_SHOWN,
      labelValueIds: params.getAll(PARAMS.labelValueIds).flatMap((value) => idSchema('labelValue').safeParse(value).data ?? []),
    },
  };
}
