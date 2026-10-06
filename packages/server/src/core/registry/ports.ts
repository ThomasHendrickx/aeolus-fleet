import type { DeliveryId, DeliveryState, FleetId, LeaseId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { Recipient } from '../shared/selector.js';
import type { CrewRequest } from './crew-request.js';
import type { Fleet } from './fleet.js';
import type { InstallationRequest } from './installation-request.js';
import type { FleetLimitSettings, InstallationSettings } from './limits.js';
import type { Lease, Location } from './lease.js';
import type { Ship } from './ship.js';
import type { ShipReport } from './ship-report.js';

/** The crew a report speaks for: its ship and lease, in its fleet. */
export interface CrewOfLease {
  fleetId: FleetId;
  shipId: ShipId;
  leaseId: LeaseId;
}

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
  /** The fleet, locked until the unit of work ends, so two deletes of it never both run. */
  findForUpdate(fleetId: FleetId): Promise<Fleet | undefined>;
  /**
   * Deletes the fleet and every record in it, for good: its ships, leases,
   * secrets, operator account, console sessions and sign-in tickets, messages, deliveries,
   * events, and the installation's record of the request that created it
   * (decision 0020).
   */
  delete(fleetId: FleetId): Promise<void>;
  /** How the fleet's limits are set; undefined when there is no such fleet. */
  limitSettings(fleetId: FleetId): Promise<FleetLimitSettings | undefined>;
  setLimitSettings(fleetId: FleetId, settings: FleetLimitSettings): Promise<void>;
}

/** Outbound port: the installation's settings, one set for the whole installation, not scoped to a fleet (decision 0020). */
export interface InstallationSettingsRepository {
  read(): Promise<InstallationSettings>;
  write(settings: InstallationSettings): Promise<void>;
}

/** Outbound port: the installation's requests, by request id; not scoped to a fleet (decision 0020). */
export interface InstallationRequestRepository {
  /** Holds the lock on this request id until the unit of work ends, so a request and its replay never both run. */
  lock(requestId: string): Promise<void>;
  find(requestId: string): Promise<InstallationRequest | undefined>;
  record(request: InstallationRequest): Promise<void>;
}

/** Outbound port: ships, always within one fleet. */
export interface ShipRepository {
  create(ship: Ship): Promise<void>;
  findOperatorShip(fleetId: FleetId): Promise<Ship | undefined>;
  /** The fleet's viewer ship, when it has one (decision 0022). */
  findViewerShip(fleetId: FleetId): Promise<Ship | undefined>;
  /**
   * Holds the lock on this name in the fleet until the unit of work ends, so
   * two commissions of one name never both find it free.
   */
  lockName(fleetId: FleetId, name: string): Promise<void>;
  /** The ship, read without a lock. */
  find(fleetId: FleetId, shipId: ShipId): Promise<Ship | undefined>;
  /** The ship of the fleet that is not retired and has this name. */
  findActiveByName(fleetId: FleetId, name: string): Promise<Ship | undefined>;
  /**
   * Holds the lock on this commissioning ship's idempotency key until the unit
   * of work ends, so two commissions under one key never both find it unused.
   */
  lockCommissionKey(key: { fleetId: FleetId; by: ShipId; idempotencyKey: string }): Promise<void>;
  /**
   * Holds the fleet's ship-count lock until the unit of work ends, so two
   * commissions at the ship limit never both see room for one more.
   */
  lockShipCount(fleetId: FleetId): Promise<void>;
  /** The fleet's ships that are not retired, argo included. */
  countActive(fleetId: FleetId): Promise<number>;
  /** The ship this commissioning ship commissioned under this idempotency key, retired or not. */
  findByCommissionKey(key: { fleetId: FleetId; by: ShipId; idempotencyKey: string }): Promise<Ship | undefined>;
  /**
   * The ship, locked against a second lock until the unit of work ends: a use
   * case that locks it, such as a new starting prompt, locks it first. Lock
   * order: the ship, then its credential, then console sessions, then leases.
   * Rows that only point at the ship can still be written meanwhile. A claim
   * never locks the ship: it holds the credential, which a prompt holding the
   * ship waits for, so locking the ship there would deadlock.
   */
  findForUpdate(fleetId: FleetId, shipId: ShipId): Promise<Ship | undefined>;
  /**
   * The ship a message is addressed to, held until the unit of work ends
   * against a use case that locks it to change it, such as a retire: that use
   * case waits for the send and then sees its delivery, or the send waits for
   * it and then reads the ship as it left it. Many sends to one ship hold it
   * at once.
   */
  findForShare(fleetId: FleetId, shipId: ShipId): Promise<Ship | undefined>;
  /** The ship of the fleet that is not retired and has this name, held as {@link findForShare} holds it. */
  findActiveByNameForShare(fleetId: FleetId, name: string): Promise<Ship | undefined>;
  /** Whether at least one ship of the fleet with this type is not retired and receives: the viewer ship receives nothing (decision 0022). */
  hasActiveShipOfType(fleetId: FleetId, type: string): Promise<boolean>;
  /** Gives the ship a new name. */
  rename(change: { fleetId: FleetId; shipId: ShipId; name: string }): Promise<void>;
  /** Marks the ship retired at `at`: never claimed or addressed again, its name free. */
  retire(change: { fleetId: FleetId; shipId: ShipId; at: Date }): Promise<void>;
}

/** Outbound port: leases, always within one fleet. */
export interface LeaseRepository {
  /** The ship's open lease, locked until the unit of work ends. */
  findOpenForUpdate(fleetId: FleetId, shipId: ShipId): Promise<Lease | undefined>;
  /**
   * The lease if it is still open, held until the unit of work ends against a
   * use case that ends it, such as a release or a takeover: that one waits for
   * this unit of work, then finds what it wrote. Many units of work hold one
   * lease at once.
   */
  findOpenByIdForShare(fleetId: FleetId, leaseId: LeaseId): Promise<Lease | undefined>;
  /** The ship's open lease, held as {@link findOpenByIdForShare} holds it. */
  findOpenForShare(fleetId: FleetId, shipId: ShipId): Promise<Lease | undefined>;
  open(lease: Lease): Promise<void>;
  /**
   * Marks the lease last seen `at`, as a call by its crew does, keeping a
   * later mark: two overlapping writes never move it back.
   */
  markSeen(seen: { fleetId: FleetId; leaseId: LeaseId; at: Date }): Promise<void>;
  /** The lease's report, the lease locked until the unit of work ends; undefined once it has ended. */
  findReportForUpdate(fleetId: FleetId, leaseId: LeaseId): Promise<{ report: ShipReport | null } | undefined>;
  saveReport(change: { fleetId: FleetId; leaseId: LeaseId; report: ShipReport }): Promise<void>;
  /**
   * The lease's report and the last report of the lease its ship held before
   * it, the one that ended last; undefined once this lease has ended.
   */
  findReportLog(fleetId: FleetId, leaseId: LeaseId): Promise<{ report: ShipReport | null; previousCrew: ShipReport | null } | undefined>;
  /** Ends the lease if it is still open and returns it; undefined when it had already ended. */
  end(change: { fleetId: FleetId; leaseId: LeaseId; endedAt: Date }): Promise<Lease | undefined>;
}

/**
 * Outbound port: crew requests, at most one per ship, always within one
 * fleet. A use case that changes one locks its ship first.
 */
export interface CrewRequestRepository {
  find(fleetId: FleetId, shipId: ShipId): Promise<CrewRequest | undefined>;
  /** Stores the ship's request, replacing the one it held. */
  save(request: CrewRequest): Promise<void>;
  remove(fleetId: FleetId, shipId: ShipId): Promise<void>;
  /** The requests assigned to this trierarch ship, oldest ship first. */
  listAssignedTo(fleetId: FleetId, trierarchShipId: ShipId): Promise<CrewRequest[]>;
}

/** A delivery a lease held in flight, pending again: which one, the message it carries, who it is for and its claims so far. */
export interface ReturnedDelivery {
  deliveryId: DeliveryId;
  messageId: MessageId;
  /** The ship or the type it is pending for again. */
  recipient: Recipient;
  attempts: number;
}

/**
 * Outbound port: the deliveries a lease holds in flight. Registry's need,
 * stated in its own words, so it never reaches into Messaging.
 */
export interface InFlightDeliveries {
  /**
   * Returns every delivery the lease holds in flight to pending and lists
   * them, oldest first. Only the claim is cleared: the recipient stays, so a
   * delivery to the ship is back in its inbox and one to a type back in that
   * type's queue, and its attempts stay, so the fifth claim still stops it.
   */
  returnToPending(fleetId: FleetId, leaseId: LeaseId): Promise<ReturnedDelivery[]>;
  /**
   * Abandons every delivery pending for the ship itself and lists them,
   * oldest first. Deliveries to its type stay, for the other ships of the
   * type; an undeliverable one stays for the operator.
   */
  abandonPendingTo(fleetId: FleetId, shipId: ShipId): Promise<AbandonedDelivery[]>;
}

/** A delivery to a ship that was retired before taking it. */
export interface AbandonedDelivery {
  deliveryId: DeliveryId;
  messageId: MessageId;
}

/** What the fleet listing reads about one ship: the ship, the lease of the session crewing it, and its valid secret. */
export interface ShipFacts {
  ship: Ship;
  /**
   * Where the session holding the ship's open lease runs, since when, and its
   * last call (its claim until it calls again); null while no session crews it.
   */
  openLease: { location: Location; harness: string | null; startedAt: Date; lastSeenAt: Date; report: ShipReport | null } | null;
  /** When the ship's valid secret was issued and claimed; null when it holds none. */
  validSecret: { issuedAt: Date; claimedAt: Date | null } | null;
  /** The ship's crew request; null when it holds none. */
  crewRequest: CrewRequest | null;
  /** The trierarch ship its crew request is assigned to, by id and name; null while unassigned or without a request. */
  crewRequestAssignee: { id: ShipId; name: string } | null;
  /**
   * The newest ping to the ship: when it was sent, its delivery's state, and
   * when pong answered it, if pong did; null before any ping.
   */
  lastPing: { sentAt: Date; deliveryState: DeliveryState; answeredWithPongAt: Date | null } | null;
  /** The last model the ship's sessions stated on a send, and when, resends left out; null before any. */
  lastModel: { id: string; statedAt: Date } | null;
  /** The viewer ship's: when one of its viewer sessions, which hold no lease, was last used; null before any (decision 0022). */
  lastViewedAt: Date | null;
  /** When the ship's last ended lease ended (a release, deregister or takeover); null before any. */
  lastLeaseEndedAt: Date | null;
}

/**
 * Outbound port: every ship of the fleet with its lease and secret, read in one
 * query, oldest ship first. Registry's need for secret dates, stated in its own
 * words, so it never reaches into Identity.
 */
/** A fleet as the installation sees it (docs/architecture.md, "Installation"). */
export interface InstallationFleetFacts {
  fleetId: FleetId;
  name: string;
  operatorEmail: string;
  createdAt: Date;
  /** Its ships that are not retired, argo included. */
  shipCount: number;
  /** Every message stored in the fleet at or after the given time, whatever its kind or sender. */
  messagesSince: number;
  /** The time of its newest event of any kind; null before any. */
  lastActivityAt: Date | null;
  /** The UTF-8 bytes of every message payload it ever stored. */
  storage: number;
  /** The messages it stored on each UTC day (YYYY-MM-DD) from the window's first day on; a day without any is left out. */
  messagesPerUtcDay: { date: string; count: number }[];
  /** How its limits are set. */
  limitSettings: FleetLimitSettings;
}

/** What a read of the installation's fleets counts messages over: since a moment, and per UTC day from a first day. */
export interface InstallationFleetWindow {
  since: Date;
  firstDay: Date;
}

/** Outbound port: the fleets read across the installation; reachable only with the installation token. */
export interface InstallationFleets {
  /** Every fleet, oldest first, counting its messages over the window. */
  list(window: InstallationFleetWindow): Promise<InstallationFleetFacts[]>;
  find(fleetId: FleetId, window: InstallationFleetWindow): Promise<InstallationFleetFacts | undefined>;
}

export interface FleetListing {
  ships(fleetId: FleetId): Promise<ShipFacts[]>;
  /** One ship of the fleet, read the same way; undefined when the fleet has no such ship. */
  ship(fleetId: FleetId, shipId: ShipId): Promise<ShipFacts | undefined>;
  /**
   * The ship's deliveries as its page counts them: in flight with it (what a
   * release returns) and its direct ones pending or in flight (what a retire
   * abandons).
   */
  deliveryCounts(fleetId: FleetId, shipId: ShipId): Promise<{ inFlight: number; open: number }>;
}
