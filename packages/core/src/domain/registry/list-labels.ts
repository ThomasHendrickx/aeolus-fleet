import type { Caller } from '../shared/caller.js';
import type { LabelValue, ListedLabel } from './label.js';
import type { FleetListing } from './ports.js';
import type { ReadReachOf } from './read-reach.js';

/** A label as `fleet.labels` lists it: each value with how many active ships in the caller's read reach carry it. */
export interface CountedLabel extends Omit<ListedLabel, 'values'> {
  values: readonly (LabelValue & { shipCount: number })[];
}

export type ListLabels = (caller: Caller) => Promise<CountedLabel[]>;

/**
 * Use case: the labels of the caller's fleet by key, each with its values and
 * its owner (decision 0031), and with each value how many active ships carry
 * it, of those in the caller's read reach (decision 0034), counted where
 * the labels are stored rather than over every ship. The caller's scope
 * (fleet:read) is checked before this runs.
 */
export function createListLabels(deps: { listing: Pick<FleetListing, 'labels' | 'valueShipCounts'>; readReach: ReadReachOf }): ListLabels {
  return async (caller) => {
    const [labels, counts] = await Promise.all([deps.listing.labels(caller.fleetId), deps.readReach(caller).then((reach) => deps.listing.valueShipCounts(caller.fleetId, reach))]);
    return labels.map((label) => ({ ...label, values: label.values.map((value) => ({ ...value, shipCount: counts.get(value.id) ?? 0 })) }));
  };
}
