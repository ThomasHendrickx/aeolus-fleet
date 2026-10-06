import type { Fleet } from './fleet.js';
import type { FleetRepository } from './ports.js';

export type ListFleets = () => Promise<Fleet[]>;

/**
 * Use case: the fleets this installation hosts, for server commands that act
 * on one of them. Not reachable through the API: listing fleets reads across
 * tenants.
 */
export function createListFleets(deps: { fleets: Pick<FleetRepository, 'list'> }): ListFleets {
  return () => deps.fleets.list();
}
