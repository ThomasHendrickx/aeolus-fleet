import type { DeliveryId, DeliveryState, FleetId, LabelId, LabelValueId, LeaseId, LeaseWaker, MessageId, ReachRefusalId, ScopeName, ShipId, ShipPosition } from '@aeolus-fleet/common';

import type { Page, PageQuery } from '../shared/page.js';
import type { Recipient } from '../shared/selector.js';
import type { ShipFilter } from './ship-filter.js';
import type { ShipSort } from './ship-order.js';
import type { ReadReach } from './read-reach.js';
import type { ClearRequest } from './clear-request.js';
import type { CrewRequest } from './crew-request.js';
import type { Fleet } from './fleet.js';
import type { InstallationRequest } from './installation-request.js';
import type { CarriedLabel, Label, LabelOwner, ListedLabel, ShipLabel } from './label.js';
import type { FleetLimitSettings, InstallationSettings } from './limits.js';
import type { Lease, Location } from './lease.js';
import type { DeclaredNetworkRules } from './declared-network-rules.js';
import type { NetworkSettings } from './network-settings.js';
import type { NetworkRulesDraft } from './network-rules-draft.js';
import type { ReachRefusal } from './reach-refusal.js';
import type { ScopeNamespace } from './scope-namespace.js';
import type { Commissioner, Ship } from './ship.js';
import type { ShipCounts } from './ship-counts.js';
import type { ShipReport } from './ship-report.js';
import type { StatedStatement } from './statement.js';
import type { Turn } from './turn.js';
import type { FactWriter, WrittenFacts } from './verified-facts.js';

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
  /** The fleet, read without a lock. */
  find(fleetId: FleetId): Promise<Fleet | undefined>;
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
   * Holds the lock on this commissioning actor's idempotency key until the unit
   * of work ends, so two commissions under one key never both find it unused.
   */
  lockCommissionKey(key: { fleetId: FleetId; by: Commissioner; idempotencyKey: string }): Promise<void>;
  /**
   * Holds the fleet's ship-count lock until the unit of work ends, so two
   * commissions at the ship limit never both see room for one more.
   */
  lockShipCount(fleetId: FleetId): Promise<void>;
  /** The fleet's ships that are not retired, argo included. */
  countActive(fleetId: FleetId): Promise<number>;
  /** The ship this commissioning actor commissioned under this idempotency key, retired or not. */
  findByCommissionKey(key: { fleetId: FleetId; by: Commissioner; idempotencyKey: string }): Promise<Ship | undefined>;
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
  /** Every ship of the fleet, retired ones and the viewer ship included. By id. */
  list(fleetId: FleetId): Promise<Ship[]>;
  /** The fleet's ships that are not retired and receive, argo included, never the viewer ship (decision 0022). By id. */
  listActive(fleetId: FleetId): Promise<Ship[]>;
  /** The fleet's ships of the type that may take a type delivery: not retired, never the viewer ship. By id. */
  listActiveOfType(fleetId: FleetId, type: string): Promise<Ship[]>;
  /** Gives the ship a new name. */
  rename(change: { fleetId: FleetId; shipId: ShipId; name: string }): Promise<void>;
  /** The active ships the owner owns, each locked as findForUpdate locks it, by id (decision 0045). */
  listActiveOwnedByForUpdate(fleetId: FleetId, ownerShipId: ShipId): Promise<Ship[]>;
  /** Gives the ship a new owner (decision 0045). */
  setOwner(change: { fleetId: FleetId; shipId: ShipId; ownerShipId: ShipId }): Promise<void>;
  /** Marks the ship retired at `at`: never claimed or addressed again, its name free. */
  retire(change: { fleetId: FleetId; shipId: ShipId; at: Date }): Promise<void>;
  /** Gives the ship these scopes, in this order, in place of the ones it held (decision 0046). */
  setScopes(change: { fleetId: FleetId; shipId: ShipId; scopes: readonly ScopeName[] }): Promise<void>;
  /** The ships not retired that hold any scope of this plugin namespace, each locked as findForUpdate locks it, by id (decision 0046). */
  listActiveHoldingInForUpdate(fleetId: FleetId, namespace: string): Promise<Ship[]>;
  /** The scopes of this plugin namespace that a ship not retired holds, each once, by name (decision 0046). */
  scopesHeldIn(fleetId: FleetId, namespace: string): Promise<ScopeName[]>;
}

/**
 * Outbound port: the plugin namespaces of a fleet (decision 0046), one per
 * declaring ship, unique in the fleet. Lock order: the declaring or granted
 * ship, then the namespace.
 */
export interface ScopeNamespaceRepository {
  /** Holds the lock on this namespace in the fleet until the unit of work ends: a declaration, and a grant of its scopes, wait for each other. */
  lockNamespace(fleetId: FleetId, namespace: string): Promise<void>;
  /** The namespace, read without a lock. */
  find(fleetId: FleetId, namespace: string): Promise<ScopeNamespace | undefined>;
  /** The namespace this ship declared, if any. */
  findByDeclarer(fleetId: FleetId, shipId: ShipId): Promise<ScopeNamespace | undefined>;
  /** Every plugin namespace of the fleet, by namespace. */
  list(fleetId: FleetId): Promise<ScopeNamespace[]>;
  /** Stores the namespace with its whole list of scopes, replacing the list it had. */
  save(namespace: ScopeNamespace): Promise<void>;
  /** The namespace goes, freed for another ship. */
  remove(fleetId: FleetId, namespace: string): Promise<void>;
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
  /**
   * When the crew of the ship's open lease last called the fleet (when it
   * claimed the ship, before any call), read without a lock; undefined when
   * the ship holds no lease.
   */
  findLastSeen(fleetId: FleetId, shipId: ShipId): Promise<Date | undefined>;
  /** The lease's report, the lease locked until the unit of work ends; undefined once it has ended. */
  findReportForUpdate(fleetId: FleetId, leaseId: LeaseId): Promise<{ report: ShipReport | null } | undefined>;
  saveReport(change: { fleetId: FleetId; leaseId: LeaseId; report: ShipReport }): Promise<void>;
  /** The lease's statement, the lease locked until the unit of work ends; undefined once it has ended (decision 0047). */
  findStatementForUpdate(fleetId: FleetId, leaseId: LeaseId): Promise<{ stated: StatedStatement | null } | undefined>;
  saveStatement(change: { fleetId: FleetId; leaseId: LeaseId; stated: StatedStatement }): Promise<void>;
  /** Every open lease of the fleet by its ship, with the statement it holds, read without a lock: who is crewed now, and what each crew stated. */
  listOpenStatements(fleetId: FleetId): Promise<{ shipId: ShipId; stated: StatedStatement | null }[]>;
  /** The open lease's turn, locked until the unit of work ends, so two turn reports take turns; undefined once it has ended. */
  findTurnForUpdate(fleetId: FleetId, leaseId: LeaseId): Promise<{ turn: Turn | null } | undefined>;
  saveTurn(change: { fleetId: FleetId; leaseId: LeaseId; turn: Turn }): Promise<void>;
  /**
   * The lease's report and the last report of the lease its ship held before
   * it, the one that ended last; undefined once this lease has ended.
   */
  findReportLog(fleetId: FleetId, leaseId: LeaseId): Promise<{ report: ShipReport | null; previousCrew: ShipReport | null } | undefined>;
  /** Ends the lease if it is still open and returns it; undefined when it had already ended. */
  end(change: { fleetId: FleetId; leaseId: LeaseId; endedAt: Date }): Promise<Lease | undefined>;
  /**
   * Marks the open lease pushed from `at`, keeping an earlier mark, before
   * anything else of the lease is locked: two marks take turns and never
   * deadlock with the units of work holding it. True when this call marked it.
   * The waker it states is kept with the first mark only (interop 5.1).
   */
  markPushed(pushed: { fleetId: FleetId; leaseId: LeaseId; at: Date; waker: LeaseWaker | null }): Promise<boolean>;
  /** Whether a push receive marked the lease pushed. */
  isPushed(fleetId: FleetId, leaseId: LeaseId): Promise<boolean>;
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

/**
 * Outbound port: the pending clear requests (decision 0032), one per
 * trierarch, ship and repository, always within one fleet. Lock the
 * trierarch ship first.
 */
export interface ClearRequestRepository {
  find(fleetId: FleetId, key: { trierarchShipId: ShipId; shipId: ShipId; repository: string }): Promise<ClearRequest | undefined>;
  save(request: ClearRequest): Promise<void>;
  remove(fleetId: FleetId, key: { trierarchShipId: ShipId; shipId: ShipId; repository: string }): Promise<void>;
  /** Every trierarch's, by trierarch, oldest first. */
  list(fleetId: FleetId): Promise<ClearRequest[]>;
  /** One trierarch's, oldest first. */
  listFor(fleetId: FleetId, trierarchShipId: ShipId): Promise<ClearRequest[]>;
}

/**
 * Outbound port: the fleet's network settings, one per fleet (decision 0034).
 * A send holds them shared and a change holds them exclusively, so every send is
 * checked against exactly one version.
 */
export interface NetworkSettingsRepository {
  /** The fleet's settings, held shared until the unit of work ends; none at version 0 when it never set rules. */
  findForShare(fleetId: FleetId): Promise<NetworkSettings>;
  /** The fleet's settings as they stand, with no lock: for a call that takes them exclusively later, which a shared hold would deadlock against. */
  find(fleetId: FleetId): Promise<NetworkSettings>;
  /** The fleet's settings, held exclusively until the unit of work ends, even before the fleet first set rules. */
  findForUpdate(fleetId: FleetId): Promise<NetworkSettings>;
  save(settings: NetworkSettings): Promise<void>;
}

/** Outbound port: the draft of the fleet's own rules, one per fleet at most (decision 0034). Nothing in force reads it. */
export interface NetworkRulesDraftRepository {
  /** The fleet's draft; none while it has none. */
  find(fleetId: FleetId): Promise<NetworkRulesDraft | undefined>;
  /** Keeps the draft in place of the fleet's one before. */
  save(draft: NetworkRulesDraft): Promise<void>;
  /** The fleet's draft goes; none goes nothing. */
  remove(fleetId: FleetId): Promise<void>;
}

/** Each ship's declared network rules (decision 0037). */
export interface DeclaredNetworkRulesRepository {
  /** Every declarer's declared rules in the fleet: the ships by id, the order they were commissioned, then the installation's. */
  list(fleetId: FleetId): Promise<DeclaredNetworkRules[]>;
  /** The declarer's declared rules; none while it declares none. */
  find(fleetId: FleetId, declarer: LabelOwner): Promise<DeclaredNetworkRules | undefined>;
  /** Keeps the declarer's whole list from now on; an empty one keeps none. */
  save(declared: DeclaredNetworkRules): Promise<void>;
}

/** Outbound port: the verified facts each writer holds about a ship, always within one fleet (decision 0059). */
export interface VerifiedFactsRepository {
  /** The writer's facts about the ship; none while it holds none. */
  find(fleetId: FleetId, key: { shipId: ShipId; writer: FactWriter }): Promise<WrittenFacts | undefined>;
  /** Keeps the writer's facts about the ship, in place of those it held. */
  save(written: WrittenFacts): Promise<void>;
  /** Removes the writer's facts about the ship, if it holds any. */
  remove(fleetId: FleetId, key: { shipId: ShipId; writer: FactWriter }): Promise<void>;
  /** Every writer's facts about every ship of the fleet, in no order. */
  list(fleetId: FleetId): Promise<WrittenFacts[]>;
  /** Every writer's facts about the ship. */
  listAbout(fleetId: FleetId, shipId: ShipId): Promise<WrittenFacts[]>;
  /** The ship's facts, as a writer, about every ship. */
  listBy(fleetId: FleetId, shipId: ShipId): Promise<WrittenFacts[]>;
  /** Holds a writer ship against its retire until commit: a set by it takes this, shared. */
  holdWriter(fleetId: FleetId, shipId: ShipId): Promise<void>;
  /** Locks a writer ship against every set by it until commit: its retire takes this. */
  lockWriter(fleetId: FleetId, shipId: ShipId): Promise<void>;
}

/** Outbound port: the records of the sends the fleet's network rules refused (decision 0034). */
export interface ReachRefusalRepository {
  record(refusal: ReachRefusal): Promise<void>;
  /** A page of the fleet's refusals, newest first by id, after the refusal the cursor names. Read outside a unit of work. */
  latest(fleetId: FleetId, query: PageQuery<ReachRefusalId>): Promise<Page<ReachRefusal, ReachRefusalId>>;
}

/**
 * Outbound port: the fleet's labels, their values and the values its ships
 * carry, always within one fleet (decision 0031). A retired or deleted label
 * is gone. Lock order: the ship being labelled, then the label.
 */
export interface LabelRepository {
  /** Holds the lock on this key in the fleet until the unit of work ends, so two definitions of one key never both find it free. */
  lockKey(fleetId: FleetId, key: string): Promise<void>;
  /** The label with this key, read without a lock. */
  findByKey(fleetId: FleetId, key: string): Promise<Label | undefined>;
  /** The label, read without a lock. */
  find(fleetId: FleetId, labelId: LabelId): Promise<Label | undefined>;
  /** The labels with one of these ids or a value with one of these ids, as rules name them, by key, read without a lock. */
  listNamedBy(fleetId: FleetId, named: { labelIds: readonly LabelId[]; valueIds: readonly LabelValueId[] }): Promise<Label[]>;
  /** The label, locked until the unit of work ends: changing its values. */
  findForUpdate(fleetId: FleetId, labelId: LabelId): Promise<Label | undefined>;
  /** The label that has this value, held until the unit of work ends against a change of its values, its deletion or its retirement, as an assignment holds it. */
  findByValueForShare(fleetId: FleetId, valueId: LabelValueId): Promise<Label | undefined>;
  /** The labels this ship owns, by key, each locked against assignments until the unit of work ends: they go. */
  listOwnedByForUpdate(fleetId: FleetId, ownerShipId: ShipId): Promise<Label[]>;
  /** Stores the label with its values, in their order, replacing the values it had. A removed value no ship carries by then. */
  save(label: Label): Promise<void>;
  /** The label goes, with its values. No ship carries any of them by then. */
  remove(fleetId: FleetId, labelId: LabelId): Promise<void>;
  /** The values the ship carries. */
  carriedBy(fleetId: FleetId, shipId: ShipId): Promise<ShipLabel[]>;
  /** Every ship's assignment of a value of this label, by ship. */
  carriersOf(fleetId: FleetId, labelId: LabelId): Promise<ShipLabel[]>;
  /** The ship carries the value, beside the values it carries. */
  assign(assignment: ShipLabel): Promise<void>;
  unassign(assignment: Pick<ShipLabel, 'fleetId' | 'shipId' | 'valueId'>): Promise<void>;
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
  /** The ship's owner by id and name; null for argo and the viewer (decision 0045). */
  owner: { id: ShipId; name: string } | null;
  /** The trierarchs that gave its crew request back, by id and name, oldest first (#382); none without a request. */
  crewRequestGivenBack: { trierarch: { id: ShipId; name: string }; settingsVersion: number; reason: string; givenBackAt: Date }[];
  /** The label values the ship carries, by key then value (decision 0031). */
  labels: readonly CarriedLabel[];
  /**
   * The ship that got the starting prompt the open lease claimed with, by id
   * and name: the actor of the ship's last StartingPromptIssued before the
   * lease started. Null while no session crews it, or when no prompt is known.
   */
  crewedBy: { id: ShipId; name: string } | null;
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
  /** Whether its deliveries reach their ships. */
  health: FleetHealth;
}

/**
 * A fleet's health as the installation reads it (#304): where its deliveries
 * wait, read from their states and times, never their payloads.
 */
export interface FleetHealth {
  /** When its oldest pending delivery was sent; null when none is pending. */
  oldestPendingAt: Date | null;
  /** Since when its oldest delivery in flight (received or handed) is in its state, as the overdue clocks read it; null when none is. */
  oldestInFlightAt: Date | null;
  /** Its pending deliveries to a type no active ship can take: none of the type, or none of the reachable ones (decision 0034). */
  noShipCanTake: number;
  /** Its undeliverable and not handled deliveries: what Needs attention lists for Resend or Dismiss. */
  needsAttention: number;
  /** The overdue deliveries argo was told of that still stand: what Needs attention shows as overdue. */
  overdue: number;
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

/**
 * Which of the fleet's ships a listing reads: those the filter selects, in
 * the sort's order (ship-order), after a position, at most `limit`; the
 * caller's read reach decides what of a ship it filters and sorts by.
 */
export interface ShipPage {
  after?: ShipPosition;
  limit: number;
  filter: ShipFilter;
  sort?: ShipSort;
  reach: ReadReach;
}

export interface FleetListing {
  /** A page of the fleet's ships as `page` selects and orders them, each with its position (decision 4 of the performance design). */
  ships(fleetId: FleetId, page: ShipPage): Promise<{ facts: ShipFacts; position: ShipPosition }[]>;
  /** The fleet's labels by key, each with its values and its owner by id and name (decision 0031). */
  labels(fleetId: FleetId): Promise<ListedLabel[]>;
  /** One ship of the fleet, read the same way; undefined when the fleet has no such ship. */
  ship(fleetId: FleetId, shipId: ShipId): Promise<ShipFacts | undefined>;
  /** The ships in `reach` counted per kind, as `shipCountsOf` counts them, without reading each ship. */
  counts(fleetId: FleetId, reach: ReadReach): Promise<ShipCounts[]>;
  /**
   * The ship's deliveries as its page counts them: in flight with it (what a
   * release returns) and its direct ones pending or in flight (what a retire
   * abandons).
   */
  deliveryCounts(fleetId: FleetId, shipId: ShipId): Promise<{ inFlight: number; open: number }>;
  /** The statement the ship's open lease holds; null while no session crews it or its crew stated none (decision 0047). */
  statement(fleetId: FleetId, shipId: ShipId): Promise<StatedStatement | null>;
}
