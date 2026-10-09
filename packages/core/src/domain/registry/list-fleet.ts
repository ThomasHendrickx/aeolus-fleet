import type { LabelValueId, Scope, ShipId, ShipKind, ShipStatus } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Location } from './lease.js';
import { pingStatusOf, type PingStatus } from './ping-status.js';
import type { CrewRequest } from './crew-request.js';
import { carriesEvery, type CarriedLabel } from './label.js';
import type { FleetListing, ShipFacts } from './ports.js';
import type { ShipReport } from './ship-report.js';
import { shipStatus } from './ship.js';

/** A ship as the fleet snapshot shows it. */
export interface ListedShip {
  id: ShipId;
  name: string;
  type: string;
  /** `operator` for `argo`, which is never released, renamed or retired; `agent` for every other ship. */
  kind: ShipKind;
  status: ShipStatus;
  /**
   * The starting prompt holding the ship's valid secret: when it was issued
   * and whether a session has claimed the ship with it. Null when no secret is
   * valid. An unclaimed one is outstanding: a new prompt would stop it working.
   */
  startingPrompt: { issuedAt: Date; isClaimed: boolean } | null;
  /** Where the session crewing the ship runs, as it reported on claim; null while no session crews it. */
  location: Location | null;
  /** The last call of the session crewing it; null while no session crews it. Observation only. */
  lastSeenAt: Date | null;
  /** The ship's last ping and how it stands; null before any ping. Observation only. */
  ping: PingStatus | null;
  /** What the ship may do: every agent ship sends and receives, and may hold fleet scopes; argo has all. */
  scopes: readonly Scope[];
  /** The crew's last report with the version of its details, never the details; null until it reports, and while no session crews the ship. */
  report: Omit<ShipReport, 'details'> | null;
  /** The ship's crew request by its settings version and when it was requested, never its settings; null when it holds none. */
  crewRequest:
    | (Pick<CrewRequest, 'settingsVersion' | 'requestedAt' | 'status' | 'reason' | 'attempt' | 'sessionStartedAt'> & {
        /** The trierarch ship it is assigned to, by id and name; null while unassigned. */
        assignedTo: { id: ShipId; name: string } | null;
        /** The ship that got the starting prompt its crew claimed with: argo for a hand crew, or its trierarch; null while not crewed. */
        crewedBy: { id: ShipId; name: string } | null;
        /** The trierarchs that gave it back before their crew was final, by id and name, oldest first (#382). */
        givenBack: ShipFacts['crewRequestGivenBack'];
      })
    | null;
  /** The label values the ship carries, with their labels, by key then value (decision 0031); none for a ship without. */
  labels: readonly CarriedLabel[];
  /** The harness the crewing session stated, read together with its location; null while no session crews the ship. */
  harness: string | null;
  /** The ship's current model: the last its sessions stated on a send, and when; null before any. */
  model: { id: string; statedAt: Date } | null;
  /** Since when the ship awaits crew: its commission, or when its last session ended (a release or deregister). Null unless it awaits crew. */
  awaitingCrewSince: Date | null;
  /** When the operator retired the ship; null while it is active. */
  retiredAt: Date | null;
}

export type ListFleet = (caller: Caller, input?: { valueIds?: readonly LabelValueId[] }) => Promise<ListedShip[]>;

/**
 * Use case: every ship of the caller's fleet, `argo` included, oldest first,
 * or with label value ids only the ships that carry every one of them
 * (decision 0031). Never a secret, a crew token or their hashes. The
 * caller's scope (fleet:read) is checked before this runs.
 */
export function createListFleet(deps: { listing: FleetListing }): ListFleet {
  return async (caller, input) =>
    (await deps.listing.ships(caller.fleetId)).filter((facts) => carriesEvery(facts.labels, input?.valueIds)).map(listedShipOf);
}

/** A ship as the fleet snapshot shows it, from what the listing read about it. */
export function listedShipOf({
  ship,
  openLease,
  validSecret,
  crewRequest,
  crewRequestAssignee,
  crewRequestGivenBack,
  labels,
  crewedBy,
  lastPing,
  lastModel,
  lastViewedAt,
  lastLeaseEndedAt,
}: ShipFacts): ListedShip {
  const status = shipStatus(ship, { isCrewed: openLease !== null });
  return {
    id: ship.id,
    name: ship.name,
    type: ship.type,
    kind: ship.kind,
    status,
    startingPrompt: validSecret && { issuedAt: validSecret.issuedAt, isClaimed: validSecret.claimedAt !== null },
    location: openLease?.location ?? null,
    // The viewer ship holds no lease: it was last seen when its most recent viewer session was used.
    lastSeenAt: openLease?.lastSeenAt ?? lastViewedAt,
    ping: pingStatusOf(lastPing),
    scopes: ship.scopes,
    report: openLease?.report ? listedReportOf(openLease.report) : null,
    crewRequest: crewRequest && {
      settingsVersion: crewRequest.settingsVersion,
      requestedAt: crewRequest.requestedAt,
      assignedTo: crewRequestAssignee,
      status: crewRequest.status,
      reason: crewRequest.reason,
      crewedBy,
      attempt: crewRequest.attempt,
      sessionStartedAt: crewRequest.sessionStartedAt,
      givenBack: crewRequestGivenBack,
    },
    labels,
    harness: openLease?.harness ?? null,
    model: lastModel,
    awaitingCrewSince: status === 'awaitingCrew' ? latestOf(ship.createdAt, lastLeaseEndedAt) : null,
    retiredAt: ship.retiredAt,
  };
}

function listedReportOf({ state, note, reportedAt, detailsVersion }: ShipReport): ListedShip['report'] {
  return { state, note, reportedAt, detailsVersion };
}

function latestOf(first: Date, second: Date | null): Date {
  return second !== null && second > first ? second : first;
}
