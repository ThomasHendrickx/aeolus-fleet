import type { FleetId, LeaseId, ShipId } from '@aeolus-fleet/common';

import type { Fleet } from './fleet.js';
import type { Lease } from './lease.js';
import type { Ship } from './ship.js';

/** Outbound port: fleets. The only repository whose reads are not scoped to one fleet. */
export interface FleetRepository {
  /**
   * Holds the installation-wide initialisation lock until the unit of work
   * ends, so two initialisations never both see an installation without fleets.
   */
  lockInitialisation(): Promise<void>;
  count(): Promise<number>;
  list(): Promise<Fleet[]>;
  create(fleet: Fleet): Promise<void>;
}

/** Outbound port: ships, always within one fleet. */
export interface ShipRepository {
  create(ship: Ship): Promise<void>;
  findOperatorShip(fleetId: FleetId): Promise<Ship | undefined>;
  /**
   * Holds the lock on this name in the fleet until the unit of work ends, so
   * two commissions of one name never both find it free.
   */
  lockName(fleetId: FleetId, name: string): Promise<void>;
  /** The ship of the fleet that is not retired and has this name. */
  findActiveByName(fleetId: FleetId, name: string): Promise<Ship | undefined>;
  /**
   * The ship, locked against a second lock until the unit of work ends: what
   * changes its secret or its lease locks it first. Lock order: the ship, then
   * its credential, then console sessions, then leases. Rows that only point
   * at the ship can still be written meanwhile.
   */
  findForUpdate(fleetId: FleetId, shipId: ShipId): Promise<Ship | undefined>;
}

/** Outbound port: leases, always within one fleet. */
export interface LeaseRepository {
  /** The ship's open lease, locked until the unit of work ends. */
  findOpenForUpdate(fleetId: FleetId, shipId: ShipId): Promise<Lease | undefined>;
  open(lease: Lease): Promise<void>;
  /** Ends the lease if it is still open and returns it; undefined when it had already ended. */
  end(change: { fleetId: FleetId; leaseId: LeaseId; endedAt: Date }): Promise<Lease | undefined>;
}

/**
 * Outbound port: a ship's deliveries in flight. Registry's need, stated in its
 * own words, so it never reaches into Messaging.
 */
export interface InFlightDeliveries {
  /** Returns every delivery the ship holds in flight to pending, and says how many. */
  returnToPending(fleetId: FleetId, shipId: ShipId): Promise<number>;
}

/** What the fleet listing reads about one ship: the ship, whether a session crews it, and its valid secret. */
export interface ShipFacts {
  ship: Ship;
  isCrewed: boolean;
  /** When the ship's valid secret was issued and claimed; null when it holds none. */
  validSecret: { issuedAt: Date; claimedAt: Date | null } | null;
}

/**
 * Outbound port: every ship of the fleet with its lease and secret, read in one
 * query, oldest ship first. Registry's need for secret dates, stated in its own
 * words, so it never reaches into Identity.
 */
export interface FleetListing {
  ships(fleetId: FleetId): Promise<ShipFacts[]>;
}
