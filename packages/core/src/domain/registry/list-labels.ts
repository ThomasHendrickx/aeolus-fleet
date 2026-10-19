import type { Caller } from '../shared/caller.js';
import type { ListedLabel } from './label.js';
import type { FleetListing } from './ports.js';

export type ListLabels = (caller: Caller) => Promise<ListedLabel[]>;

/**
 * Use case: the labels of the caller's fleet by key, each with its values and
 * its owner (decision 0031). The caller's scope (fleet:read) is checked
 * before this runs.
 */
export function createListLabels(deps: { listing: Pick<FleetListing, 'labels'> }): ListLabels {
  return (caller) => deps.listing.labels(caller.fleetId);
}
