import type { ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { listedShipOf, type ListedShip } from './list-fleet.js';
import type { FleetListing } from './ports.js';
import type { ShipReport } from './ship-report.js';

/** One ship for its page: as the fleet lists it, with its crew's report whole, when it was commissioned and since when it is crewed. */
export interface ShipDetail extends Omit<ListedShip, 'report'> {
  /** The crew's last report, details included; null until it reports, and while no session crews the ship. */
  report: ShipReport | null;
  commissionedAt: Date;
  /** Since when the session crewing it has held it; null while no session does. */
  crewedSince: Date | null;
  /** What its crew holds in flight: what a release or a re-crew returns to pending. */
  inFlightDeliveries: number;
  /** Its direct deliveries pending or in flight: what a retire abandons. */
  openDeliveries: number;
}

export type GetShip = (caller: Caller, input: { shipId: ShipId }) => Promise<Result<ShipDetail, DomainError<'SHIP_NOT_FOUND'>>>;

/**
 * Use case: one ship of the caller's fleet, retired ships included: they keep
 * their page. The caller's scope (fleet:read or fleet:crew) is checked before this runs.
 */
export function createGetShip(deps: { listing: FleetListing }): GetShip {
  return async (caller, { shipId }) => {
    const facts = await deps.listing.ship(caller.fleetId, shipId);
    if (!facts) {
      return refuse('SHIP_NOT_FOUND', `No ship ${shipId} in this fleet`);
    }
    const counts = await deps.listing.deliveryCounts(caller.fleetId, shipId);
    return ok({
      ...listedShipOf(facts),
      report: facts.openLease?.report ?? null,
      inFlightDeliveries: counts.inFlight,
      openDeliveries: counts.open,
      commissionedAt: facts.ship.createdAt,
      crewedSince: facts.openLease?.startedAt ?? null,
    });
  };
}
