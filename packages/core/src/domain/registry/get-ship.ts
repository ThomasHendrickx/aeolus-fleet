import type { ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { listedShipOf, outsideReadReach, type ListedShip, type ShipOutsideReadReach } from './list-fleet.js';
import { readsShip, type ReadReachOf } from './read-reach.js';
import { checkReaches, type CrewRequest } from './crew-request.js';
import type { FleetListing } from './ports.js';
import { shownReportOf, type ShownReport } from './ship-report.js';

/** One ship for its page: as the fleet lists it, with its crew's report whole, when it was commissioned and since when it is crewed. */
export interface ShipDetail extends Omit<ListedShip, 'report' | 'crewRequest'> {
  /** The ship's crew request, settings included; null when it holds none. */
  crewRequest: (NonNullable<ListedShip['crewRequest']> & Pick<CrewRequest, 'settings'>) | null;
  /** The crew's last report, details and their size included; null until it reports, and while no session crews the ship. */
  report: ShownReport | null;
  commissionedAt: Date;
  /** Since when the session crewing it has held it; null while no session does. */
  crewedSince: Date | null;
  /** What its crew holds in flight: what a release or a re-crew returns to pending. */
  inFlightDeliveries: number;
  /** Its direct deliveries pending or in flight: what a retire abandons. */
  openDeliveries: number;
  /** Its owner by id and name; null for argo and the viewer (decision 0045). */
  owner: { id: ShipId; name: string } | null;
}

export type GetShip = (
  caller: Caller,
  input: { shipId: ShipId },
) => Promise<Result<ShipDetail | ShipOutsideReadReach, DomainError<'SHIP_NOT_FOUND' | 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER'>>>;

/** The scopes that read every ship; crew:run reads only the ships assigned to the caller's ship. */
const READ_SCOPES = ['fleet:read'] as const;

/**
 * Use case: one ship of the caller's fleet, retired ships included: they keep
 * their page. The caller's scope (fleet:read or crew:run) is
 * checked before this runs; crew:run reads only the ships whose crew requests
 * are assigned to the caller's ship, whole. Any other ship outside the
 * caller's read reach shows its name, type and status only (decision 0034).
 */
export function createGetShip(deps: { listing: FleetListing; readReach: ReadReachOf }): GetShip {
  return async (caller, { shipId }) => {
    const facts = await deps.listing.ship(caller.fleetId, shipId);
    if (!facts) {
      return refuse('SHIP_NOT_FOUND', `No ship ${shipId} in this fleet`);
    }
    const reaches = checkReaches(caller, { ship: facts.ship, current: facts.crewRequest, broadScopes: READ_SCOPES });
    if (!reaches.isOk) {
      return reaches;
    }
    const listed = listedShipOf(facts);
    if (facts.crewRequest?.assignedTo !== caller.shipId && !readsShip(await deps.readReach(caller), shipId)) {
      return ok(outsideReadReach(listed));
    }
    const counts = await deps.listing.deliveryCounts(caller.fleetId, shipId);
    return ok({
      ...listed,
      report: facts.openLease?.report ? shownReportOf(facts.openLease.report) : null,
      crewRequest: listed.crewRequest && facts.crewRequest && { ...listed.crewRequest, settings: facts.crewRequest.settings },
      inFlightDeliveries: counts.inFlight,
      openDeliveries: counts.open,
      commissionedAt: facts.ship.createdAt,
      crewedSince: facts.openLease?.startedAt ?? null,
      owner: facts.owner,
    });
  };
}
