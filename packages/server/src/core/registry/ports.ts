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
}

/** Outbound port: leases, always within one fleet. */
export interface LeaseRepository {
  /** The ship's open lease, locked until the unit of work ends. */
  findOpenForUpdate(fleetId: FleetId, shipId: ShipId): Promise<Lease | undefined>;
  open(lease: Lease): Promise<void>;
  /** Ends the lease if it is still open and returns it; undefined when it had already ended. */
  end(fleetId: FleetId, leaseId: LeaseId, endedAt: Date): Promise<Lease | undefined>;
}

/**
 * Outbound port: a ship's deliveries in flight. Registry's need, stated in its
 * own words, so it never reaches into Messaging.
 */
export interface InFlightDeliveries {
  /** Returns every delivery the ship holds in flight to pending, and says how many. */
  returnToPending(fleetId: FleetId, shipId: ShipId): Promise<number>;
}
