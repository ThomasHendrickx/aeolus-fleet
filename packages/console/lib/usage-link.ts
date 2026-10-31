import type { ShipId } from '@aeolus-fleet/common';

/**
 * Where the machine card and a ship's Crew request card link to: the Usage
 * page filtered to a machine or to a ship. The search parameters are the ones
 * the Usage page reads from its URL (features/usage/services/usage-state.ts).
 */
export function usageLinkOf(filter: { machine: ShipId } | { ship: ShipId }): string {
  return 'machine' in filter ? `/usage?machine=${filter.machine}` : `/usage?ship=${filter.ship}`;
}
