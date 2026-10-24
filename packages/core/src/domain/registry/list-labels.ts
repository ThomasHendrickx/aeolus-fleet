import type { Caller } from '../shared/caller.js';
import type { LabelValue, ListedLabel } from './label.js';
import type { FleetListing } from './ports.js';
import type { ReadReachOf } from './read-reach.js';

/** A label as `fleet.labels` lists it: with how many active ships in the caller's read reach carry any of its values, and each value with how many carry it. */
export interface CountedLabel extends Omit<ListedLabel, 'values'> {
  shipCount: number;
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
export function createListLabels(deps: { listing: Pick<FleetListing, 'labels' | 'labelShipCounts'>; readReach: ReadReachOf }): ListLabels {
  return async (caller) => {
    const [labels, counts] = await Promise.all([deps.listing.labels(caller.fleetId), deps.readReach(caller).then((reach) => deps.listing.labelShipCounts(caller.fleetId, reach))]);
    return labels.map((label) => ({
      ...label,
      shipCount: counts.labels.get(label.id) ?? 0,
      values: label.values.map((value) => ({ ...value, shipCount: counts.values.get(value.id) ?? 0 })),
    }));
  };
}
