import type { CrewRequestKey, LabelValueId, ShipStatus } from '@aeolus-fleet/common';

import { carriesEvery } from './label.js';
import type { ListedShip } from './list-fleet.js';

/**
 * Which ships a page of the fleet snapshot selects (decision 4 of the
 * performance design): the overview's search and filters, applied where the
 * ships are read, so a page holds only matches. Every filter combines with
 * AND; one left out, or empty, selects every ship.
 */
export interface ShipFilter {
  /** Text the ship's name or type holds, in any case. */
  query?: string;
  /** Any of these statuses. */
  status?: readonly ShipStatus[];
  /** Any of these types. */
  type?: readonly string[];
  /** Any of these crew request keys (crewRequestKeyOf). */
  crewRequest?: readonly CrewRequestKey[];
  /** Every one of these label values (decision 0031). */
  valueIds?: readonly LabelValueId[];
}

/**
 * Where a ship's crew request stands, as one key: none; assigned to a
 * trierarch, the status it wrote, crewing before it wrote one; crewed by hand
 * while still unassigned; or else needs crew.
 */
export function crewRequestKeyOf(crewRequest: ListedShip['crewRequest']): CrewRequestKey {
  if (crewRequest === null) {
    return 'none';
  }
  if (crewRequest.assignedTo !== null) {
    return crewRequest.status ?? 'crewing';
  }
  return crewRequest.crewedBy === null ? 'needsCrew' : 'crewedByHand';
}

/** Whether the ship is one the filter selects. */
export function matchesShipFilter(ship: ListedShip, filter: ShipFilter): boolean {
  const query = filter.query?.trim().toLowerCase() ?? '';
  return (
    (query === '' || ship.name.toLowerCase().includes(query) || ship.type.toLowerCase().includes(query)) &&
    isPicked(filter.status, ship.status) &&
    isPicked(filter.type, ship.type) &&
    isPicked(filter.crewRequest, crewRequestKeyOf(ship.crewRequest)) &&
    carriesEvery(ship.labels, filter.valueIds)
  );
}

function isPicked<Value>(picked: readonly Value[] | undefined, value: Value): boolean {
  return picked === undefined || picked.length === 0 || picked.includes(value);
}
