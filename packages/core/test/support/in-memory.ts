import { createIdGenerator, idSchema, LEASE_END_REASONS, PING_CONTENT_TYPE, withdrawalOf, type DeliveryId, type FleetId, type IdGenerator, type LabelValueId, type LeaseWaker, type MessageId, type ShipId } from '@aeolus-fleet/common';

import type { ConsoleSession } from '../../src/domain/identity/console-session.js';
import type { Credential } from '../../src/domain/identity/credential.js';
import type { Guide, GuideProgress } from '../../src/domain/identity/guide.js';
import type { ConsoleSignIn, Notice } from '../../src/domain/identity/notice.js';
import type { OperatorAccount } from '../../src/domain/identity/operator-account.js';
import type { SignInTicket } from '../../src/domain/identity/sign-in-ticket.js';
import type {
  AuthenticatedShip,
  CallerLookup,
  ConsoleSessionRepository,
  GuideProgressRepository,
  GuideRepository,
  NoticeDismissals,
  NoticeRepository,
  SignInTicketRepository,
  CredentialRepository,
  OperatorAccountLookup,
  OperatorAccountRepository,
} from '../../src/domain/identity/ports.js';
import type { Meeting } from '../../src/domain/messaging/meeting.js';
import type { Schedule } from '../../src/domain/messaging/schedule.js';
import type { Delivery, Message } from '../../src/domain/messaging/message.js';
import type { Overdue, PushedCrew, WaitingDelivery } from '../../src/domain/messaging/overdue.js';
import type {
  DeliveryRepository,
  MeetingRepository,
  MessageRepository,
  OverdueDeliveryRepository,
  PushedCrews,
  ReceiverAddress,
  ReceiverWakeups,
  ScheduleAttempts,
  ScheduleNotice,
  ScheduleNotifier,
  ScheduleRepository,
} from '../../src/domain/messaging/ports.js';
import type { Fleet } from '../../src/domain/registry/fleet.js';
import type { InstallationRequest } from '../../src/domain/registry/installation-request.js';
import { FOLLOWING_DEFAULTS, NO_INSTALLATION_SETTINGS, type FleetLimitSettings, type InstallationSettings } from '../../src/domain/registry/limits.js';
import type { Lease } from '../../src/domain/registry/lease.js';
import type {
  FleetListing,
  ShipFacts,
  FleetRepository,
  InFlightDeliveries,
  FleetHealth,
  InstallationFleetFacts,
  InstallationFleets,
  InstallationFleetWindow,
  InstallationRequestRepository,
  InstallationSettingsRepository,
  LeaseRepository,
  ClearRequestRepository,
  CrewRequestRepository,
  LabelRepository,
  DeclaredNetworkRulesRepository,
  NetworkRulesDraftRepository,
  ScopeNamespaceRepository,
  DefinedScopeRepository,
  VerifiedFactsRepository,
  NetworkSettingsRepository,
  ReachRefusalRepository,
  ShipRepository,
} from '../../src/domain/registry/ports.js';
import { isSameOwner, type Label, type LabelOwner, type ListedLabel, type ShipLabel } from '../../src/domain/registry/label.js';
import { matchesShipFilter } from '@aeolus-fleet/common/rules';
import { readsShip } from '../../src/domain/registry/read-reach.js';
import { comparePositions, positionOf } from '../../src/domain/registry/ship-order.js';
import type { DeclaredNetworkRules } from '../../src/domain/registry/declared-network-rules.js';
import type { NetworkRulesDraft } from '../../src/domain/registry/network-rules-draft.js';
import type { DefinedScope } from '../../src/domain/registry/defined-scope.js';
import type { ScopeNamespace } from '../../src/domain/registry/scope-namespace.js';
import { noNetworkSettings, type NetworkSettings } from '../../src/domain/registry/network-settings.js';
import type { ReachRefusal } from '../../src/domain/registry/reach-refusal.js';
import { shipCountsOf } from '../../src/domain/registry/ship-counts.js';
import { isSameCommissioner, type Ship } from '../../src/domain/registry/ship.js';
import { listedShipOf } from '../../src/domain/registry/list-fleet.js';
import type { ShipReport } from '../../src/domain/registry/ship-report.js';
import type { StatedStatement } from '../../src/domain/registry/statement.js';
import type { Turn } from '../../src/domain/registry/turn.js';
import { isSameWriter, type WrittenFacts } from '../../src/domain/registry/verified-facts.js';
import type { ClearRequest } from '../../src/domain/registry/clear-request.js';
import type { CrewRequest } from '../../src/domain/registry/crew-request.js';
import type { Clock } from '../../src/domain/shared/clock.js';
import type { EventLog, FleetEvent, FleetEventFeed, FleetEventWakeups, SequencedEvent } from '../../src/domain/shared/events.js';
import { deliveryStepOf, type StandingOverdue, type WayCrew, type WayLease } from '../../src/domain/shared/delivery-way.js';
import {
  isKeptBy,
  type HistoryMessage,
  type InboxEntry,
  type HistoryParty,
  type HistoryLabelValue,
  type HistoryRecipient,
  type ShipHistory,
  type TimelineEntry,
} from '../../src/domain/shared/history.js';
import type { FleetLimitReads } from '../../src/domain/shared/read-fleet-limits.js';
import type { Addressee } from '../../src/domain/shared/selector.js';
import { appliedLimits } from '../../src/domain/registry/applied-limits.js';
import type { DeliveryNotice, Notifier } from '../../src/domain/shared/notifier.js';
import type { PasswordHasher, RandomTokens, SecretHasher } from '../../src/domain/shared/secrets.js';
import type { UnitOfWork } from '../../src/domain/shared/unit-of-work.js';
import { utcDayStart } from '../../src/domain/shared/utc-day.js';
import type { HealthRecords } from '../../src/domain/shared/health.js';
import { pageOf } from '../../src/domain/shared/page.js';
import { createInMemoryHealthRecords } from './in-memory-health.js';
import type { HealthSnapshotWriter } from '../../src/domain/shared/health-snapshot.js';
import type { HistoryPruner } from '../../src/domain/shared/history-pruning.js';
import { createInMemoryHealthSnapshots, type HeldHourSnapshot } from './in-memory-health-snapshots.js';
import { createInMemoryHistoryPruner } from './in-memory-history-pruner.js';

/**
 * In-memory ports for unit tests of the core. Every repository reads and writes
 * one plain state object; the unit of work restores it when the work refuses or
 * throws, so tests can prove a use case leaves nothing behind.
 */

export interface InMemoryState {
  fleets: Fleet[];
  ships: Ship[];
  leases: Lease[];
  /** The leases a push receive marked pushed, and from when. */
  pushedLeases: { fleetId: FleetId; leaseId: Lease['id']; at: Date; waker?: LeaseWaker | null }[];
  credentials: Credential[];
  operatorAccounts: OperatorAccount[];
  consoleSessions: ConsoleSession[];
  signInTickets: SignInTicket[];
  /** The installation's console notices (decision 0023), in its order. */
  installationNotices: Notice[];
  noticeDismissals: { fleetId: FleetId; signIn: ConsoleSignIn; noticeId: string; at: Date }[];
  /** The installation's guide (decision 0024), or none. */
  installationGuide: Guide | null;
  guideProgress: ({ fleetId: FleetId; signIn: ConsoleSignIn; at: Date } & GuideProgress)[];
  messages: Message[];
  deliveries: Delivery[];
  /** The meetings with their participants (decision 0061). */
  meetings: Meeting[];
  /** The ships' schedules (decision 0062). */
  schedules: Schedule[];
  /** The notices a unit of work sent for the servers' schedule timers: gone again when it rolls back, as a NOTIFY. */
  scheduleNotices: ScheduleNotice[];
  /** When each lease was last seen through a call by its crew: the last_seen_at column, apart from the Lease. */
  leaseSeen: { fleetId: FleetId; leaseId: Lease['id']; at: Date }[];
  /** Each lease's crew report: the report columns, apart from the Lease. */
  leaseReports: { fleetId: FleetId; leaseId: Lease['id']; report: ShipReport }[];
  leaseStatements: { fleetId: FleetId; leaseId: Lease['id']; stated: StatedStatement }[];
  leaseTurns: { fleetId: FleetId; leaseId: Lease['id']; turn: Turn }[];
  crewRequests: CrewRequest[];
  /** The pending clear requests (decision 0032). */
  clearRequests: ClearRequest[];
  /** The fleet's labels, by key (decision 0031): a retired label is gone. */
  labels: Label[];
  /** The label values each ship carries: a set of value ids per ship. */
  shipLabels: ShipLabel[];
  /** Each fleet's network settings, once it set rules (decision 0034). */
  networkSettings: NetworkSettings[];
  /** The network rules each ship declared on the labels it owns (decision 0037): no row for a ship that declares none. */
  declaredNetworkRules: DeclaredNetworkRules[];
  /** Each fleet's draft of its own rules, while it has one (decision 0034). */
  networkRulesDrafts: NetworkRulesDraft[];
  /** The plugin namespaces, one per declaring ship (decision 0046). */
  scopeNamespaces: ScopeNamespace[];
  /** The fleet's own scopes (design gateway-scopes, 4.1). */
  definedScopes: DefinedScope[];
  /** The verified facts, one set per ship and writer (decision 0059). */
  verifiedFacts: WrittenFacts[];
  /** The records of the sends the network rules refused, oldest first. */
  reachRefusals: ReachRefusal[];
  /** When the recipient read each delivery it read: the read_at column, apart from the Delivery's state. */
  deliveryReads: { fleetId: FleetId; deliveryId: Delivery['id']; readAt: Date }[];
  events: FleetEvent[];
  /** The deliveries argo was told are overdue, once per lease and delivery, with the state each was told in. */
  overdueDeliveries: (Omit<Overdue, 'delivery'> & { deliveryId: Delivery['id']; state: WaitingDelivery['state']; at: Date })[];
  /** The installation's requests: a table that belongs to no fleet (decision 0020). */
  installationRequests: InstallationRequest[];
  /** The installation's settings: no row until it sets them, then one. */
  installationSettings: InstallationSettings[];
  /** How each fleet's limits are set: the limit columns of its fleets row, apart from the Fleet; none means it follows the defaults. */
  fleetLimitSettings: ({ fleetId: FleetId } & FleetLimitSettings)[];
  /** The notices a unit of work sent: gone again when it rolls back, as Postgres drops a NOTIFY. */
  notices: DeliveryNotice[];
  /** The stuck snapshot's hour rows, the latest with its fold. */
  healthSnapshots: HeldHourSnapshot[];
  /** The fleets whose snapshot lock another instance holds, as a test sets it. */
  healthSnapshotLocks: FleetId[];
  /** Each fleet's last pruning pass and where its finished history begins: the columns on its fleets row (decision 0066). */
  fleetPrunes: { fleetId: FleetId; prunedAt: Date | null; keptFrom: Date | null }[];
  /** The fleets whose prune lock another server holds, as a test sets it. */
  historyPruneLocks: FleetId[];
  /** The messages whose rows another transaction holds, as a test sets it: a pass skips them. */
  lockedMessages: MessageId[];
  /** The places in each fleet's stream of the events a pruning pass let go: the events left keep theirs, as Postgres's seq column does. */
  prunedEventSeqs: { fleetId: FleetId; seq: number }[];
}

/** A fleet's events, numbered in the order they were appended, the places of pruned events skipped. */
export function numberedEvents(state: Pick<InMemoryState, 'events' | 'prunedEventSeqs'>, fleetId: FleetId): SequencedEvent[] {
  const gone = new Set(state.prunedEventSeqs.filter((row) => row.fleetId === fleetId).map((row) => row.seq));
  let seq = 0;
  return state.events
    .filter((event) => event.fleetId === fleetId)
    .map((event) => {
      do {
        seq += 1;
      } while (gone.has(seq));
      return { ...event, seq };
    });
}

export interface InMemoryTx {
  fleets: FleetRepository;
  ships: ShipRepository;
  leases: LeaseRepository;
  crewRequests: CrewRequestRepository;
  clearRequests: ClearRequestRepository;
  labels: LabelRepository;
  networkSettings: NetworkSettingsRepository;
  declaredNetworkRules: DeclaredNetworkRulesRepository;
  networkRulesDrafts: NetworkRulesDraftRepository;
  scopeNamespaces: ScopeNamespaceRepository;
  definedScopes: DefinedScopeRepository;
  verifiedFacts: VerifiedFactsRepository;
  reachRefusals: ReachRefusalRepository;
  inFlightDeliveries: InFlightDeliveries;
  credentials: CredentialRepository;
  operatorAccounts: OperatorAccountRepository;
  consoleSessions: ConsoleSessionRepository;
  signInTickets: SignInTicketRepository;
  messages: MessageRepository;
  deliveries: DeliveryRepository;
  meetings: MeetingRepository;
  schedules: ScheduleRepository;
  overdueDeliveries: OverdueDeliveryRepository;
  events: EventLog;
  notifier: Notifier;
  scheduleNotifier: ScheduleNotifier;
  installationRequests: InstallationRequestRepository;
  installationSettings: InstallationSettingsRepository;
  healthSnapshots: HealthSnapshotWriter;
  historyPruner: HistoryPruner;
}

/**
 * Wake-ups for a waiting receive, played by the test. A wait takes the next
 * scripted step, which may send a message or move the clock and says whether
 * it woke the receive; without one, the whole wait passes on the clock and
 * times out.
 */
export interface InMemoryWakeups extends ReceiverWakeups {
  /** Every ship and type a receive watched, in order. */
  watched: ReceiverAddress[];
  /** Every wait a receive began, in milliseconds. */
  waits: number[];
  /** What the next waits do, first one first. */
  nextWaits: (() => Promise<'woken' | 'timedOut'>)[];
  /** How many watches have not stopped. */
  watching(): number;
}

export interface InMemoryFleetNews extends FleetEventWakeups {
  /** Every fleet a wait watched for news, in order. */
  watched: FleetId[];
  /** Every wait begun, in milliseconds. */
  waits: number[];
  /** What the next waits do, first one first. */
  nextWaits: (() => Promise<'woken' | 'timedOut'>)[];
  /** How many watches have not stopped. */
  watching(): number;
}

export interface InMemoryCore {
  state: InMemoryState;
  uow: UnitOfWork<InMemoryTx>;
  /** The ships, read outside a unit of work. */
  ships: ShipRepository;
  /** The leases, read outside a unit of work. */
  leases: LeaseRepository;
  /** The fleets, read outside a unit of work. */
  fleets: FleetRepository;
  /** When each fleet's next schedule attempt is due, read outside a unit of work. */
  scheduleAttempts: ScheduleAttempts;
  /** The open pushed leases and what waits for them, for the clocks. */
  pushedCrews: PushedCrews;
  /** The crew requests, read outside a unit of work. */
  crewRequests: CrewRequestRepository;
  /** The clear requests, read outside a unit of work. */
  clearRequests: ClearRequestRepository;
  /** The labels and what ships carry, read outside a unit of work. */
  labels: LabelRepository;
  /** The records of the sends the network rules refused, read outside a unit of work. */
  reachRefusals: ReachRefusalRepository;
  /** The rules ships declared, read outside a unit of work. */
  declaredNetworkRules: DeclaredNetworkRulesRepository;
  /** The plugin namespaces, read outside a unit of work. */
  scopeNamespaces: ScopeNamespaceRepository;
  /** The fleet's own scopes, read outside a unit of work. */
  definedScopes: DefinedScopeRepository;
  callers: CallerLookup;
  accounts: OperatorAccountLookup;
  listing: FleetListing;
  /** The fleets read across the installation. */
  installationFleets: InstallationFleets;
  /** The installation's settings, read outside a unit of work. */
  installationSettings: InstallationSettingsRepository;
  /** What each fleet's limits apply to, read outside a unit of work. */
  fleetLimitReads: FleetLimitReads;
  /** The committed events, numbered per fleet in the order they were appended. */
  feed: FleetEventFeed;
  /** The history reads for the ship page, from the events, messages and deliveries held. */
  history: ShipHistory;
  /** What the stuck rule reads (decision 0042), from the ships, leases, deliveries and events held. */
  health: HealthRecords;
  /** The stuck snapshot, read outside a unit of work. */
  healthSnapshots: HealthSnapshotWriter;
  /** The installation's notices and each console session's dismissals. */
  notices: NoticeRepository;
  noticeDismissals: NoticeDismissals;
  /** The installation's guide and each console session's progress in it. */
  guide: GuideRepository;
  guideProgress: GuideProgressRepository;
  clock: Clock & { set(iso: string | Date): void; advance(ms: number): void };
  ids: IdGenerator;
  hasher: SecretHasher;
  passwords: PasswordHasher;
  random: RandomTokens;
  wakeups: InMemoryWakeups;
  /** Wakes a wait on news of its fleet: any committed event. */
  fleetNews: InMemoryFleetNews;
}

/** Whether a receive or a push receive holds the delivery: received or handed, in flight with its crew. */
/** The ships' declared rules by ship id, then the installation's, as Postgres lists them. */
function declarerOrder(declarer: LabelOwner): string {
  return declarer.kind === 'ship' ? `0${declarer.shipId}` : '1';
}

function isInFlight(delivery: Delivery): boolean {
  return delivery.state === 'received' || delivery.state === 'handed';
}

/** Oldest first, as Postgres orders them: by creation, then by id. */
/** Forced deliveries before plain ones, keeping the order within each. */
function byForce(first: Delivery, second: Delivery): number {
  return Number(second.isForced) - Number(first.isForced);
}

function byAge(first: Delivery, second: Delivery): number {
  return first.createdAt.getTime() - second.createdAt.getTime() || first.id.localeCompare(second.id);
}

export function createInMemoryCore(startAt = '2026-09-29T12:00:00.000Z'): InMemoryCore {
  const state: InMemoryState = {
    fleets: [],
    ships: [],
    leases: [],
    pushedLeases: [],
    credentials: [],
    operatorAccounts: [],
    consoleSessions: [],
    signInTickets: [],
    installationNotices: [],
    noticeDismissals: [],
    installationGuide: null,
    guideProgress: [],
    messages: [],
    deliveries: [],
    meetings: [],
    schedules: [],
    scheduleNotices: [],
    deliveryReads: [],
    leaseSeen: [],
    leaseReports: [],
    leaseStatements: [],
    leaseTurns: [],
    crewRequests: [],
    clearRequests: [],
    labels: [],
    shipLabels: [],
    networkSettings: [],
    declaredNetworkRules: [],
    networkRulesDrafts: [],
    scopeNamespaces: [],
    definedScopes: [],
    verifiedFacts: [],
    reachRefusals: [],
    events: [],
    overdueDeliveries: [],
    installationRequests: [],
    installationSettings: [],
    fleetLimitSettings: [],
    notices: [],
    healthSnapshots: [],
    healthSnapshotLocks: [],
    fleetPrunes: [],
    historyPruneLocks: [],
    lockedMessages: [],
    prunedEventSeqs: [],
  };

  let now = new Date(startAt);
  const clock = {
    now: () => new Date(now),
    set: (iso: string | Date) => {
      now = new Date(iso);
    },
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };

  const ids = createIdGenerator({ now: () => now.getTime() });

  let tokenCount = 0;
  const random: RandomTokens = {
    next: () => {
      tokenCount += 1;
      return `random-${String(tokenCount)}`;
    },
  };
  const hasher: SecretHasher = { hash: (value) => `sha256(${value})` };
  const passwords: PasswordHasher = {
    hash: (password) => Promise.resolve(`argon2id(${password})`),
    verify: (password, passwordHash) => Promise.resolve(passwordHash === `argon2id(${password})`),
  };

  const networkSettingsOf = (fleetId: FleetId): NetworkSettings =>
    structuredClone(state.networkSettings.find((held) => held.fleetId === fleetId) ?? noNetworkSettings(fleetId));

  const copyOfLabel = (label: Label): Label => ({ ...label, values: label.values.map((value) => ({ ...value })) });
  const labelWhere = (matches: (label: Label) => boolean): Label | undefined => {
    const held = state.labels.find(matches);
    return held && copyOfLabel(held);
  };

  const ship = (fleetId: FleetId, shipId: ShipId): Ship | undefined =>
    state.ships.find((candidate) => candidate.fleetId === fleetId && candidate.id === shipId);

  const authenticated = (found: Ship): AuthenticatedShip => ({
    shipId: found.id,
    fleetId: found.fleetId,
    kind: found.kind,
    scopes: found.scopes,
  });

  const installationSettingsRepository: InstallationSettingsRepository = {
    read: () => Promise.resolve({ ...(state.installationSettings[0] ?? NO_INSTALLATION_SETTINGS) }),
    write: (settings) => {
      state.installationSettings.splice(0, state.installationSettings.length, { ...settings });
      return Promise.resolve();
    },
  };

  const healthRecords = createInMemoryHealthRecords(state);
  const healthSnapshots = createInMemoryHealthSnapshots(state, healthRecords);
  const tx: InMemoryTx = {
    healthSnapshots,
    historyPruner: createInMemoryHistoryPruner(state),
    fleets: {
      lockInitialisation: () => Promise.resolve(),
      count: () => Promise.resolve(state.fleets.length),
      list: () => Promise.resolve(state.fleets.map((fleet) => ({ ...fleet }))),
      create: (fleet) => {
        state.fleets.push({ ...fleet });
        return Promise.resolve();
      },
      limitSettings: (fleetId) => {
        if (!state.fleets.some((fleet) => fleet.id === fleetId)) {
          return Promise.resolve(undefined);
        }
        const set = state.fleetLimitSettings.find((held) => held.fleetId === fleetId);
        return Promise.resolve(
          set
            ? { ships: set.ships, dailyMessages: set.dailyMessages, schedulesPerShip: set.schedulesPerShip, minimumScheduleInterval: set.minimumScheduleInterval, retention: set.retention }
            : FOLLOWING_DEFAULTS,
        );
      },
      setLimitSettings: (fleetId, settings) => {
        state.fleetLimitSettings.splice(0, state.fleetLimitSettings.length, ...state.fleetLimitSettings.filter((held) => held.fleetId !== fleetId), { fleetId, ...settings });
        return Promise.resolve();
      },
      find: (fleetId) => {
        const fleet = state.fleets.find((held) => held.id === fleetId);
        return Promise.resolve(fleet && { ...fleet });
      },
      findForUpdate: (fleetId) => {
        const fleet = state.fleets.find((held) => held.id === fleetId);
        return Promise.resolve(fleet && { ...fleet });
      },
      delete: (fleetId) => {
        // Every table that belongs to a fleet, as the Postgres adapter deletes them.
        state.fleets.splice(0, state.fleets.length, ...state.fleets.filter((fleet) => fleet.id !== fleetId));
        for (const table of FLEET_TABLES) {
          const rows: { fleetId: FleetId }[] = state[table];
          rows.splice(0, rows.length, ...rows.filter((row) => row.fleetId !== fleetId));
        }
        const { installationRequests } = state;
        installationRequests.splice(
          0,
          installationRequests.length,
          ...installationRequests.filter((request) => request.kind !== 'createFleet' || request.fleetId !== fleetId),
        );
        return Promise.resolve();
      },
    },
    ships: {
      create: (created) => {
        if (
          state.ships.some(
            (held) => held.fleetId === created.fleetId && held.name === created.name && held.retiredAt === null,
          )
        ) {
          return Promise.reject(new Error('unique violation: an active ship of the fleet already has this name'));
        }
        state.ships.push({ ...created });
        return Promise.resolve();
      },
      findOperatorShip: (fleetId) =>
        Promise.resolve(state.ships.find((found) => found.fleetId === fleetId && found.kind === 'operator')),
      findViewerShip: (fleetId) => Promise.resolve(state.ships.find((found) => found.fleetId === fleetId && found.kind === 'viewer')),
      lockName: () => Promise.resolve(),
      // One test runs one unit of work at a time: nothing to wait for.
      lockShipCount: () => Promise.resolve(),
      countActive: (fleetId) => Promise.resolve(state.ships.filter((ship) => ship.fleetId === fleetId && ship.retiredAt === null).length),
      lockCommissionKey: () => Promise.resolve(),
      findByCommissionKey: ({ fleetId, by, idempotencyKey }) =>
        Promise.resolve(
          state.ships.find(
            (found) => found.fleetId === fleetId && found.commission !== null && isSameCommissioner(found.commission.by, by) && found.commission.idempotencyKey === idempotencyKey,
          ),
        ),
      findActiveByName: (fleetId, name) =>
        Promise.resolve(
          state.ships.find((found) => found.fleetId === fleetId && found.name === name && found.retiredAt === null),
        ),
      find: (fleetId, shipId) => {
        const found = ship(fleetId, shipId);
        return Promise.resolve(found && { ...found });
      },
      findMany: (fleetId, shipIds) =>
        Promise.resolve(
          state.ships
            .filter((held) => held.fleetId === fleetId && shipIds.includes(held.id))
            .toSorted((first, second) => first.id.localeCompare(second.id))
            .map((held) => ({ ...held })),
        ),
      rename: ({ fleetId, shipId, name }) => {
        const found = ship(fleetId, shipId);
        if (found) {
          found.name = name;
        }
        return Promise.resolve();
      },
      listActiveOwnedByForUpdate: (fleetId, ownerShipId) =>
        Promise.resolve(
          state.ships
            .filter((held) => held.fleetId === fleetId && held.owner === ownerShipId && held.retiredAt === null)
            .toSorted((first, second) => first.id.localeCompare(second.id))
            .map((held) => ({ ...held })),
        ),
      setOwner: ({ fleetId, shipId, ownerShipId }) => {
        const found = ship(fleetId, shipId);
        if (found) {
          found.owner = ownerShipId;
        }
        return Promise.resolve();
      },
      retire: ({ fleetId, shipId, at }) => {
        const found = state.ships.find((held) => held.fleetId === fleetId && held.id === shipId);
        if (!found) {
          return Promise.reject(new Error(`no ship ${shipId} to retire`));
        }
        found.retiredAt = at;
        return Promise.resolve();
      },
      findForUpdate: (fleetId, shipId) => Promise.resolve(ship(fleetId, shipId)),
      findForShare: (fleetId, shipId) => {
        const found = ship(fleetId, shipId);
        return Promise.resolve(found && { ...found });
      },
      findActiveByNameForShare: (fleetId, name) => {
        const found = state.ships.find((held) => held.fleetId === fleetId && held.name === name && held.retiredAt === null);
        return Promise.resolve(found && { ...found });
      },
      list: (fleetId) =>
        Promise.resolve(
          state.ships
            .filter((held) => held.fleetId === fleetId)
            .sort((first, second) => first.id.localeCompare(second.id))
            .map((held) => structuredClone(held)),
        ),
      listActive: (fleetId) =>
        Promise.resolve(
          state.ships
            .filter((held) => held.fleetId === fleetId && held.retiredAt === null && held.kind !== 'viewer')
            .sort((first, second) => first.id.localeCompare(second.id))
            .map((held) => structuredClone(held)),
        ),
      listActiveCarryingEvery: (fleetId, valueIds) =>
        Promise.resolve(
          state.ships
            .filter(
              (held) =>
                held.fleetId === fleetId &&
                held.retiredAt === null &&
                held.kind !== 'viewer' &&
                valueIds.every((valueId) => state.shipLabels.some((carried) => carried.fleetId === fleetId && carried.shipId === held.id && carried.valueId === valueId)),
            )
            .sort((first, second) => first.id.localeCompare(second.id))
            .map((held) => structuredClone(held)),
        ),
      listActiveOfType: (fleetId, type) =>
        Promise.resolve(
          state.ships
            .filter((held) => held.fleetId === fleetId && held.type === type && held.retiredAt === null && held.kind !== 'viewer')
            .sort((first, second) => first.id.localeCompare(second.id))
            .map((held) => structuredClone(held)),
        ),
      hasActiveShipOfType: (fleetId, type) =>
        Promise.resolve(
          state.ships.some((held) => held.fleetId === fleetId && held.type === type && held.retiredAt === null && held.kind !== 'viewer'),
        ),
      setScopes: ({ fleetId, shipId, scopes }) => {
        const found = ship(fleetId, shipId);
        if (found) {
          found.scopes = [...scopes];
        }
        return Promise.resolve();
      },
      listActiveHoldingInForUpdate: (fleetId, namespace) =>
        Promise.resolve(
          state.ships
            .filter((held) => held.fleetId === fleetId && held.retiredAt === null && held.scopes.some((scope) => scope.startsWith(`${namespace}:`)))
            .toSorted((first, second) => first.id.localeCompare(second.id))
            .map((held) => ({ ...held })),
        ),
      scopesHeldIn: (fleetId, namespace) =>
        Promise.resolve(
          [...new Set(state.ships.filter((held) => held.fleetId === fleetId && held.retiredAt === null).flatMap((held) => held.scopes.filter((scope) => scope.startsWith(`${namespace}:`))))].toSorted(),
        ),
      countHolding: (fleetId, scope) => Promise.resolve(state.ships.filter((held) => held.fleetId === fleetId && held.retiredAt === null && held.scopes.includes(scope)).length),
    },
    crewRequests: {
      find: (fleetId, shipId) => {
        const request = state.crewRequests.find((held) => held.fleetId === fleetId && held.shipId === shipId);
        return Promise.resolve(request && { ...request, givenBack: [...request.givenBack] });
      },
      save: (request) => {
        const index = state.crewRequests.findIndex((held) => held.fleetId === request.fleetId && held.shipId === request.shipId);
        state.crewRequests.splice(index === -1 ? state.crewRequests.length : index, index === -1 ? 0 : 1, { ...request, givenBack: [...request.givenBack] });
        return Promise.resolve();
      },
      listAssignedTo: (fleetId, trierarchShipId) =>
        Promise.resolve(
          state.crewRequests
            .filter((request) => request.fleetId === fleetId && request.assignedTo === trierarchShipId)
            .sort((first, second) => first.shipId.localeCompare(second.shipId))
            .map((request) => ({ ...request })),
        ),
      remove: (fleetId, shipId) => {
        const index = state.crewRequests.findIndex((held) => held.fleetId === fleetId && held.shipId === shipId);
        if (index !== -1) {
          state.crewRequests.splice(index, 1);
        }
        return Promise.resolve();
      },
    },
    clearRequests: {
      find: (fleetId, key) => {
        const request = state.clearRequests.find((held) => held.fleetId === fleetId && isClearRequestKey(held, key));
        return Promise.resolve(request && { ...request });
      },
      save: (request) => {
        state.clearRequests.push({ ...request });
        return Promise.resolve();
      },
      remove: (fleetId, key) => {
        state.clearRequests.splice(0, state.clearRequests.length, ...state.clearRequests.filter((held) => held.fleetId !== fleetId || !isClearRequestKey(held, key)));
        return Promise.resolve();
      },
      list: (fleetId) =>
        Promise.resolve(
          state.clearRequests
            .filter((held) => held.fleetId === fleetId)
            .sort((first, second) => first.trierarchShipId.localeCompare(second.trierarchShipId) || first.requestedAt.getTime() - second.requestedAt.getTime())
            .map((held) => ({ ...held })),
        ),
      listFor: (fleetId, trierarchShipId) =>
        Promise.resolve(
          state.clearRequests
            .filter((held) => held.fleetId === fleetId && held.trierarchShipId === trierarchShipId)
            .sort((first, second) => first.requestedAt.getTime() - second.requestedAt.getTime())
            .map((held) => ({ ...held })),
        ),
    },
    networkSettings: {
      // One unit of work runs at a time: nothing to hold.
      findForShare: (fleetId) => Promise.resolve(networkSettingsOf(fleetId)),
      find: (fleetId) => Promise.resolve(networkSettingsOf(fleetId)),
      findForUpdate: (fleetId) => Promise.resolve(networkSettingsOf(fleetId)),
      save: (settings) => {
        const copy = structuredClone(settings);
        const index = state.networkSettings.findIndex((held) => held.fleetId === settings.fleetId);
        state.networkSettings.splice(index === -1 ? state.networkSettings.length : index, index === -1 ? 0 : 1, copy);
        return Promise.resolve();
      },
    },
    declaredNetworkRules: {
      list: (fleetId) =>
        Promise.resolve(
          state.declaredNetworkRules
            .filter((held) => held.fleetId === fleetId)
            .sort((first, second) => declarerOrder(first.declarer).localeCompare(declarerOrder(second.declarer)))
            .map((held) => structuredClone(held)),
        ),
      find: (fleetId, declarer) => Promise.resolve(structuredClone(state.declaredNetworkRules.find((held) => held.fleetId === fleetId && isSameOwner(held.declarer, declarer)))),
      save: (declared) => {
        const index = state.declaredNetworkRules.findIndex((held) => held.fleetId === declared.fleetId && isSameOwner(held.declarer, declared.declarer));
        const kept = declared.rules.length === 0 ? [] : [structuredClone(declared)];
        state.declaredNetworkRules.splice(index === -1 ? state.declaredNetworkRules.length : index, index === -1 ? 0 : 1, ...kept);
        return Promise.resolve();
      },
    },
    networkRulesDrafts: {
      find: (fleetId) => Promise.resolve(structuredClone(state.networkRulesDrafts.find((held) => held.fleetId === fleetId))),
      save: (draft) => {
        const index = state.networkRulesDrafts.findIndex((held) => held.fleetId === draft.fleetId);
        state.networkRulesDrafts.splice(index === -1 ? state.networkRulesDrafts.length : index, index === -1 ? 0 : 1, structuredClone(draft));
        return Promise.resolve();
      },
      remove: (fleetId) => {
        const index = state.networkRulesDrafts.findIndex((held) => held.fleetId === fleetId);
        if (index !== -1) {
          state.networkRulesDrafts.splice(index, 1);
        }
        return Promise.resolve();
      },
    },
    scopeNamespaces: {
      // One test runs one unit of work at a time: nothing to wait for.
      lockNamespace: () => Promise.resolve(),
      find: (fleetId, namespace) => Promise.resolve(structuredClone(state.scopeNamespaces.find((held) => held.fleetId === fleetId && held.namespace === namespace))),
      findByDeclarer: (fleetId, shipId) => Promise.resolve(structuredClone(state.scopeNamespaces.find((held) => held.fleetId === fleetId && held.declaredBy === shipId))),
      list: (fleetId) =>
        Promise.resolve(
          state.scopeNamespaces
            .filter((held) => held.fleetId === fleetId)
            .toSorted((first, second) => first.namespace.localeCompare(second.namespace))
            .map((held) => structuredClone(held)),
        ),
      save: (declared) => {
        const index = state.scopeNamespaces.findIndex((held) => held.fleetId === declared.fleetId && held.namespace === declared.namespace);
        if (index === -1 && state.scopeNamespaces.some((held) => held.fleetId === declared.fleetId && held.declaredBy === declared.declaredBy)) {
          return Promise.reject(new Error('unique violation: the ship declared a namespace already'));
        }
        state.scopeNamespaces.splice(index === -1 ? state.scopeNamespaces.length : index, index === -1 ? 0 : 1, structuredClone(declared));
        return Promise.resolve();
      },
      remove: (fleetId, namespace) => {
        state.scopeNamespaces.splice(0, state.scopeNamespaces.length, ...state.scopeNamespaces.filter((held) => held.fleetId !== fleetId || held.namespace !== namespace));
        return Promise.resolve();
      },
    },
    definedScopes: {
      find: (fleetId, scope) => Promise.resolve(structuredClone(state.definedScopes.find((held) => held.fleetId === fleetId && held.scope === scope))),
      save: (defined) => {
        const index = state.definedScopes.findIndex((held) => held.fleetId === defined.fleetId && held.scope === defined.scope);
        state.definedScopes.splice(index === -1 ? state.definedScopes.length : index, index === -1 ? 0 : 1, structuredClone(defined));
        return Promise.resolve();
      },
      remove: (fleetId, scope) => {
        state.definedScopes.splice(0, state.definedScopes.length, ...state.definedScopes.filter((held) => held.fleetId !== fleetId || held.scope !== scope));
        return Promise.resolve();
      },
      list: (fleetId) =>
        Promise.resolve(
          state.definedScopes
            .filter((held) => held.fleetId === fleetId)
            .toSorted((first, second) => (first.scope < second.scope ? -1 : 1))
            .map((held) => structuredClone(held)),
        ),
      usesNamespace: (fleetId, namespace) => Promise.resolve(state.definedScopes.some((held) => held.fleetId === fleetId && held.scope.startsWith(`${namespace}:`))),
    },
    verifiedFacts: {
      find: (fleetId, { shipId, writer }) =>
        Promise.resolve(structuredClone(state.verifiedFacts.find((held) => held.fleetId === fleetId && held.shipId === shipId && isSameWriter(held.writer, writer)))),
      save: (written) => {
        const others = state.verifiedFacts.filter((held) => held.fleetId !== written.fleetId || held.shipId !== written.shipId || !isSameWriter(held.writer, written.writer));
        state.verifiedFacts.splice(0, state.verifiedFacts.length, ...others, structuredClone(written));
        return Promise.resolve();
      },
      list: (fleetId) => Promise.resolve(structuredClone(state.verifiedFacts.filter((held) => held.fleetId === fleetId))),
      listAbout: (fleetId, shipId) => Promise.resolve(structuredClone(state.verifiedFacts.filter((held) => held.fleetId === fleetId && held.shipId === shipId))),
      listBy: (fleetId, shipId) =>
        Promise.resolve(structuredClone(state.verifiedFacts.filter((held) => held.fleetId === fleetId && held.writer.kind === 'ship' && held.writer.shipId === shipId))),
      // One unit of work at a time: nothing to hold.
      holdWriter: () => Promise.resolve(),
      lockWriter: () => Promise.resolve(),
      remove: (fleetId, { shipId, writer }) => {
        state.verifiedFacts.splice(0, state.verifiedFacts.length, ...state.verifiedFacts.filter((held) => held.fleetId !== fleetId || held.shipId !== shipId || !isSameWriter(held.writer, writer)));
        return Promise.resolve();
      },
    },
    reachRefusals: {
      record: (refusal) => {
        state.reachRefusals.push(structuredClone(refusal));
        return Promise.resolve();
      },
      latest: (fleetId, { cursor, limit }) =>
        Promise.resolve(
          pageOf(
            state.reachRefusals
              .filter((held) => held.fleetId === fleetId && (cursor === undefined || held.id < cursor))
              .sort((first, second) => second.id.localeCompare(first.id))
              .slice(0, limit + 1)
              .map((held) => structuredClone(held)),
            { limit, cursorOf: (held) => held.id },
          ),
        ),
    },
    labels: {
      // One test runs one unit of work at a time: nothing to wait for.
      lockKey: () => Promise.resolve(),
      findByKey: (fleetId, key) => Promise.resolve(labelWhere((label) => label.fleetId === fleetId && label.key === key)),
      find: (fleetId, labelId) => Promise.resolve(labelWhere((label) => label.fleetId === fleetId && label.id === labelId)),
      listNamedBy: (fleetId, { labelIds, valueIds }) =>
        Promise.resolve(
          state.labels
            .filter((label) => label.fleetId === fleetId && (labelIds.includes(label.id) || label.values.some((value) => valueIds.includes(value.id))))
            .sort((first, second) => first.key.localeCompare(second.key))
            .map(copyOfLabel),
        ),
      findForUpdate: (fleetId, labelId) => Promise.resolve(labelWhere((label) => label.fleetId === fleetId && label.id === labelId)),
      findByValueForShare: (fleetId, valueId) =>
        Promise.resolve(labelWhere((label) => label.fleetId === fleetId && label.values.some((value) => value.id === valueId))),
      listOwnedByForUpdate: (fleetId, ownerShipId) =>
        Promise.resolve(
          state.labels
            .filter((label) => label.fleetId === fleetId && label.owner.kind === 'ship' && label.owner.shipId === ownerShipId)
            .sort((first, second) => first.key.localeCompare(second.key))
            .map(copyOfLabel),
        ),
      save: (label) => {
        const index = state.labels.findIndex((held) => held.fleetId === label.fleetId && held.id === label.id);
        if (index === -1 && state.labels.some((held) => held.fleetId === label.fleetId && held.key === label.key)) {
          return Promise.reject(new Error('unique violation: the fleet has a label with this key'));
        }
        const kept = new Set(label.values.map((value) => value.id));
        const held = index === -1 ? undefined : state.labels[index];
        if (held && state.shipLabels.some((carried) => carried.labelId === label.id && !kept.has(carried.valueId))) {
          return Promise.reject(new Error('foreign key violation: a ship carries a value the label no longer has'));
        }
        state.labels.splice(index === -1 ? state.labels.length : index, index === -1 ? 0 : 1, copyOfLabel(label));
        return Promise.resolve();
      },
      remove: (fleetId, labelId) => {
        if (state.shipLabels.some((held) => held.fleetId === fleetId && held.labelId === labelId)) {
          return Promise.reject(new Error('foreign key violation: ships still carry the label'));
        }
        state.labels.splice(0, state.labels.length, ...state.labels.filter((held) => held.fleetId !== fleetId || held.id !== labelId));
        return Promise.resolve();
      },
      carriedBy: (fleetId, shipId) =>
        Promise.resolve(state.shipLabels.filter((held) => held.fleetId === fleetId && held.shipId === shipId).map((held) => ({ ...held }))),
      carriersOf: (fleetId, labelId) =>
        Promise.resolve(
          state.shipLabels
            .filter((held) => held.fleetId === fleetId && held.labelId === labelId)
            .sort((first, second) => first.shipId.localeCompare(second.shipId) || first.valueId.localeCompare(second.valueId))
            .map((held) => ({ ...held })),
        ),
      assign: (assignment) => {
        const label = labelWhere((held) => held.fleetId === assignment.fleetId && held.id === assignment.labelId);
        if (!label?.values.some((value) => value.id === assignment.valueId)) {
          return Promise.reject(new Error('foreign key violation: no such label value'));
        }
        if (!state.shipLabels.some((held) => held.fleetId === assignment.fleetId && held.shipId === assignment.shipId && held.valueId === assignment.valueId)) {
          state.shipLabels.push({ ...assignment });
        }
        return Promise.resolve();
      },
      unassign: ({ fleetId, shipId, valueId }) => {
        state.shipLabels.splice(
          0,
          state.shipLabels.length,
          ...state.shipLabels.filter((held) => held.fleetId !== fleetId || held.shipId !== shipId || held.valueId !== valueId),
        );
        return Promise.resolve();
      },
    },
    leases: {
      findOpenForUpdate: (fleetId, shipId) =>
        Promise.resolve(
          state.leases.find((lease) => lease.fleetId === fleetId && lease.shipId === shipId && lease.endedAt === null),
        ),
      open: (lease) => {
        if (state.leases.some((held) => held.shipId === lease.shipId && held.endedAt === null)) {
          return Promise.reject(new Error('unique violation: the ship already holds an open lease'));
        }
        state.leases.push({ ...lease });
        return Promise.resolve();
      },
      findOpenForShare: (fleetId, shipId) => {
        const lease = state.leases.find(
          (held) => held.fleetId === fleetId && held.shipId === shipId && held.endedAt === null,
        );
        return Promise.resolve(lease && { ...lease });
      },
      findLastSeen: (fleetId, shipId) => {
        const lease = state.leases.find((held) => held.fleetId === fleetId && held.shipId === shipId && held.endedAt === null);
        const seen = lease && state.leaseSeen.find((held) => held.fleetId === fleetId && held.leaseId === lease.id);
        return Promise.resolve(seen?.at ?? lease?.startedAt);
      },
      markSeen: ({ fleetId, leaseId, at }) => {
        const seen = state.leaseSeen.find((held) => held.fleetId === fleetId && held.leaseId === leaseId);
        if (!seen) {
          state.leaseSeen.push({ fleetId, leaseId, at });
        } else if (seen.at < at) {
          seen.at = at;
        }
        return Promise.resolve();
      },
      findReportForUpdate: (fleetId, leaseId) => {
        const isOpen = state.leases.some((held) => held.fleetId === fleetId && held.id === leaseId && held.endedAt === null);
        const held = state.leaseReports.find((each) => each.fleetId === fleetId && each.leaseId === leaseId);
        return Promise.resolve(isOpen ? { report: held ? { ...held.report } : null } : undefined);
      },
      findReportLog: (fleetId, leaseId) => {
        const lease = state.leases.find((held) => held.fleetId === fleetId && held.id === leaseId && held.endedAt === null);
        if (!lease) {
          return Promise.resolve(undefined);
        }
        const reportOf = (id: Lease['id']) => {
          const held = state.leaseReports.find((each) => each.fleetId === fleetId && each.leaseId === id);
          return held ? { ...held.report } : null;
        };
        const [previous] = state.leases
          .filter((held) => held.fleetId === fleetId && held.shipId === lease.shipId && held.id !== leaseId && held.endedAt !== null)
          .sort((first, second) => (second.endedAt?.getTime() ?? 0) - (first.endedAt?.getTime() ?? 0));
        return Promise.resolve({ report: reportOf(leaseId), previousCrew: previous ? reportOf(previous.id) : null });
      },
      saveReport: ({ fleetId, leaseId, report }) => {
        const held = state.leaseReports.find((each) => each.fleetId === fleetId && each.leaseId === leaseId);
        if (held) {
          held.report = { ...report };
        } else {
          state.leaseReports.push({ fleetId, leaseId, report: { ...report } });
        }
        return Promise.resolve();
      },
      findStatementForUpdate: (fleetId, leaseId) => {
        const isOpen = state.leases.some((held) => held.fleetId === fleetId && held.id === leaseId && held.endedAt === null);
        const held = state.leaseStatements.find((each) => each.fleetId === fleetId && each.leaseId === leaseId);
        return Promise.resolve(isOpen ? { stated: held ? structuredClone(held.stated) : null } : undefined);
      },
      saveStatement: ({ fleetId, leaseId, stated }) => {
        const held = state.leaseStatements.find((each) => each.fleetId === fleetId && each.leaseId === leaseId);
        if (held) {
          held.stated = structuredClone(stated);
        } else {
          state.leaseStatements.push({ fleetId, leaseId, stated: structuredClone(stated) });
        }
        return Promise.resolve();
      },
      listOpenStatements: (fleetId) =>
        Promise.resolve(
          state.leases
            .filter((held) => held.fleetId === fleetId && held.endedAt === null)
            .map((lease) => {
              const held = state.leaseStatements.find((each) => each.leaseId === lease.id);
              return { shipId: lease.shipId, stated: held ? structuredClone(held.stated) : null };
            }),
        ),
      findTurnForUpdate: (fleetId, leaseId) => {
        const isOpen = state.leases.some((held) => held.fleetId === fleetId && held.id === leaseId && held.endedAt === null);
        const held = state.leaseTurns.find((each) => each.fleetId === fleetId && each.leaseId === leaseId);
        return Promise.resolve(isOpen ? { turn: held ? { ...held.turn } : null } : undefined);
      },
      saveTurn: ({ fleetId, leaseId, turn }) => {
        const held = state.leaseTurns.find((each) => each.fleetId === fleetId && each.leaseId === leaseId);
        if (held) {
          held.turn = { ...turn };
        } else {
          state.leaseTurns.push({ fleetId, leaseId, turn: { ...turn } });
        }
        return Promise.resolve();
      },
      findOpenByIdForShare: (fleetId, leaseId) => {
        const lease = state.leases.find(
          (held) => held.fleetId === fleetId && held.id === leaseId && held.endedAt === null,
        );
        return Promise.resolve(lease && { ...lease });
      },
      markPushed: ({ fleetId, leaseId, at, waker }) => {
        const isOpen = state.leases.some((held) => held.fleetId === fleetId && held.id === leaseId && held.endedAt === null);
        const isMarked = isOpen && !state.pushedLeases.some((pushed) => pushed.fleetId === fleetId && pushed.leaseId === leaseId);
        if (isMarked) {
          state.pushedLeases.push({ fleetId, leaseId, at, waker });
        }
        return Promise.resolve(isMarked);
      },
      isPushed: (fleetId, leaseId) =>
        Promise.resolve(state.pushedLeases.some((pushed) => pushed.fleetId === fleetId && pushed.leaseId === leaseId)),
      end: ({ fleetId, leaseId, endedAt }) => {
        const lease = state.leases.find((held) => held.fleetId === fleetId && held.id === leaseId);
        if (lease?.endedAt !== null) {
          return Promise.resolve(undefined);
        }
        lease.endedAt = endedAt;
        return Promise.resolve({ ...lease });
      },
    },
    inFlightDeliveries: {
      returnToPending: (fleetId, leaseId) => {
        const inFlight = state.deliveries
          .filter(
            (delivery) =>
              delivery.fleetId === fleetId && isInFlight(delivery) && delivery.claimedByLeaseId === leaseId,
          )
          .sort(byAge);
        for (const delivery of inFlight) {
          delivery.state = 'pending';
          delivery.claimedByShipId = null;
          delivery.claimedByLeaseId = null;
          delivery.handOverNumber = null;
        }
        return Promise.resolve(
          inFlight.map(({ id, messageId, recipient, attempts }) => ({
            deliveryId: id,
            messageId,
            recipient: structuredClone(recipient),
            attempts,
          })),
        );
      },
      abandonPendingTo: (fleetId, shipId) => {
        const pending = state.deliveries
          .filter(
            (delivery) =>
              delivery.fleetId === fleetId &&
              delivery.state === 'pending' &&
              delivery.recipient.kind === 'ship' &&
              delivery.recipient.shipId === shipId,
          )
          .sort(byAge);
        for (const delivery of pending) {
          delivery.state = 'abandoned';
        }
        return Promise.resolve(pending.map(({ id, messageId }) => ({ deliveryId: id, messageId })));
      },
    },
    credentials: {
      create: (credential) => {
        if (state.credentials.some((held) => held.shipId === credential.shipId && held.invalidatedAt === null)) {
          return Promise.reject(new Error('unique violation: the ship already has a valid secret'));
        }
        state.credentials.push({ ...credential });
        return Promise.resolve();
      },
      findValidBySecretHashForUpdate: (secretHash) => {
        const credential = state.credentials.find(
          (held) => held.secretHash === secretHash && held.invalidatedAt === null,
        );
        return Promise.resolve(credential && { ...credential });
      },
      findValidForShipForUpdate: (fleetId, shipId) =>
        Promise.resolve(
          state.credentials.find(
            (held) => held.fleetId === fleetId && held.shipId === shipId && held.invalidatedAt === null,
          ),
        ),
      markClaimed: ({ fleetId, credentialId, at }) => {
        const credential = state.credentials.find((held) => held.fleetId === fleetId && held.id === credentialId);
        if (credential) {
          credential.claimedAt = at;
        }
        return Promise.resolve();
      },
      invalidate: ({ fleetId, credentialId, at }) => {
        const credential = state.credentials.find((held) => held.fleetId === fleetId && held.id === credentialId);
        if (credential) {
          credential.invalidatedAt = at;
        }
        return Promise.resolve();
      },
    },
    operatorAccounts: {
      // One test runs one unit of work at a time: nothing to wait for.
      lockEmail: () => Promise.resolve(),
      create: (account) => {
        if (state.operatorAccounts.some((held) => held.email === account.email || held.fleetId === account.fleetId)) {
          return Promise.reject(new Error('unique violation: the email or the fleet already has an operator account'));
        }
        state.operatorAccounts.push({ ...account });
        return Promise.resolve();
      },
      findByEmailForUpdate: (email) => {
        const account = state.operatorAccounts.find((held) => held.email === email);
        return Promise.resolve(account && { ...account });
      },
      findForFleetForUpdate: (fleetId) => {
        const account = state.operatorAccounts.find((held) => held.fleetId === fleetId);
        return Promise.resolve(account && { ...account });
      },
      findForFleet: (fleetId) => {
        const account = state.operatorAccounts.find((held) => held.fleetId === fleetId);
        return Promise.resolve(account && { ...account });
      },
      setTheme: ({ fleetId, operatorId, theme }) => {
        const account = state.operatorAccounts.find((held) => held.fleetId === fleetId && held.id === operatorId);
        if (account) {
          account.theme = theme;
        }
        return Promise.resolve();
      },
      changePassword: ({ fleetId, operatorId, passwordHash }) => {
        const account = state.operatorAccounts.find((held) => held.fleetId === fleetId && held.id === operatorId);
        if (account) {
          account.passwordHash = passwordHash;
        }
        return Promise.resolve();
      },
      changeLogin: ({ fleetId, operatorId, email, passwordHash }) => {
        const account = state.operatorAccounts.find((held) => held.fleetId === fleetId && held.id === operatorId);
        if (account) {
          account.email = email;
          account.passwordHash = passwordHash;
        }
        return Promise.resolve();
      },
    },
    consoleSessions: {
      find: (fleetId, consoleSessionId) => {
        const session = state.consoleSessions.find((held) => held.fleetId === fleetId && held.id === consoleSessionId);
        return Promise.resolve(session && { ...session });
      },
      findOperatorSignIn: (fleetId, at) => {
        const session = state.consoleSessions.findLast((held) => held.fleetId === fleetId && held.leaseId !== null && held.endedAt === null && held.expiresAt > at);
        return Promise.resolve(session && { ...session });
      },
      create: (session) => {
        if (state.consoleSessions.some((held) => held.fleetId === session.fleetId && held.endedAt === null && held.leaseId !== null) && session.leaseId !== null) {
          return Promise.reject(new Error('unique violation: the fleet already has a live console session'));
        }
        state.consoleSessions.push({ ...session });
        return Promise.resolve();
      },
      end: ({ fleetId, consoleSessionId, at, reason }) => {
        const session = state.consoleSessions.find((held) => held.fleetId === fleetId && held.id === consoleSessionId);
        if (session?.endedAt !== null) {
          return Promise.resolve(undefined);
        }
        session.endedAt = at;
        session.endReason = reason;
        return Promise.resolve({ ...session });
      },
      endAll: ({ fleetId, shipId }, { at, reason }) => {
        const open = state.consoleSessions.filter((held) => held.fleetId === fleetId && held.shipId === shipId && held.endedAt === null);
        for (const session of open) {
          session.endedAt = at;
          session.endReason = reason;
        }
        return Promise.resolve(open.map((session) => ({ ...session })));
      },
      endAllOfAccount: (accountId, { at, reason }) => {
        const open = state.consoleSessions.filter((held) => held.accountId === accountId && held.endedAt === null);
        for (const session of open) {
          session.endedAt = at;
          session.endReason = reason;
        }
        return Promise.resolve(open.map((session) => ({ ...session })));
      },
    },
    meetings: {
      create: (meeting) => {
        state.meetings.push(structuredClone(meeting));
        return Promise.resolve();
      },
      lockOpenerKey: () => Promise.resolve(),
      findByOpenerKey: ({ fleetId, openerShipId, idempotencyKey }) => {
        const found = state.meetings.find((held) => held.fleetId === fleetId && held.openedByShipId === openerShipId && held.idempotencyKey === idempotencyKey);
        return Promise.resolve(found && structuredClone(found));
      },
      find: (fleetId, meetingId) => {
        const found = state.meetings.find((held) => held.fleetId === fleetId && held.id === meetingId);
        return Promise.resolve(found && structuredClone(found));
      },
      findForShare: (fleetId, meetingId) => {
        const found = state.meetings.find((held) => held.fleetId === fleetId && held.id === meetingId);
        return Promise.resolve(found && structuredClone(found));
      },
      findForUpdate: (fleetId, meetingId) => {
        const found = state.meetings.find((held) => held.fleetId === fleetId && held.id === meetingId);
        return Promise.resolve(found && structuredClone(found));
      },
      save: (meeting) => {
        const at = state.meetings.findIndex((held) => held.fleetId === meeting.fleetId && held.id === meeting.id);
        if (at >= 0) {
          state.meetings[at] = structuredClone(meeting);
        }
        return Promise.resolve();
      },
      listPresentInForUpdate: (fleetId, shipId) =>
        Promise.resolve(
          state.meetings
            .filter((held) => held.fleetId === fleetId && held.endedAt === null && held.participants.some((participant) => participant.shipId === shipId && participant.leftAt === null))
            .map((held) => structuredClone(held)),
        ),
      contributions: (fleetId, { meetingId, cursor, limit }) => {
        const rows = state.messages
          .filter((message) => message.fleetId === fleetId && message.selector.kind === 'meeting' && message.selector.meetingId === meetingId && (cursor === undefined || message.id < cursor))
          .sort((first, second) => second.id.localeCompare(first.id))
          .slice(0, limit + 1)
          .map((message) => structuredClone(message));
        return Promise.resolve(pageOf(rows, { limit, cursorOf: (message) => message.id }));
      },
    },
    schedules: {
      create: (schedule) => {
        state.schedules.push(structuredClone(schedule));
        return Promise.resolve();
      },
      lockCreatorKey: () => Promise.resolve(),
      findByCreatorKey: ({ fleetId, shipId, idempotencyKey }) => {
        const found = state.schedules.find((held) => held.fleetId === fleetId && held.shipId === shipId && held.idempotencyKey === idempotencyKey);
        return Promise.resolve(found && structuredClone(found));
      },
      findForUpdate: (fleetId, scheduleId) => {
        const found = state.schedules.find((held) => held.fleetId === fleetId && held.id === scheduleId);
        return Promise.resolve(found && structuredClone(found));
      },
      claimDue: (fleetId, excluding) => {
        // Due by the clock, as Postgres judges it by its now().
        const due = state.schedules
          .filter((held) => held.fleetId === fleetId && held.state === 'active' && held.nextAttemptAt !== null && held.nextAttemptAt <= clock.now() && !excluding.includes(held.id))
          .sort((first, second) => (first.nextAttemptAt?.getTime() ?? 0) - (second.nextAttemptAt?.getTime() ?? 0) || first.id.localeCompare(second.id));
        return Promise.resolve(due[0] && structuredClone(due[0]));
      },
      save: (schedule) => {
        const at = state.schedules.findIndex((held) => held.fleetId === schedule.fleetId && held.id === schedule.id);
        if (at >= 0) {
          state.schedules[at] = structuredClone(schedule);
        }
        return Promise.resolve();
      },
      sentCount: (fleetId, scheduleId) => Promise.resolve(state.messages.filter((message) => message.fleetId === fleetId && message.scheduleId === scheduleId).length),
      lockShipScheduleCount: () => Promise.resolve(),
      countOpenOfShip: (fleetId, shipId) =>
        Promise.resolve(state.schedules.filter((held) => held.fleetId === fleetId && held.shipId === shipId && (held.state === 'active' || held.state === 'paused')).length),
      listOpenOfShipForUpdate: (fleetId, shipId) =>
        Promise.resolve(
          state.schedules
            .filter((held) => held.fleetId === fleetId && held.shipId === shipId && (held.state === 'active' || held.state === 'paused'))
            .map((held) => structuredClone(held)),
        ),
      page: (fleetId, { shipId, states, cursor, limit }) => {
        const rows = state.schedules
          .filter((held) => held.fleetId === fleetId && held.shipId === shipId && states.includes(held.state) && (cursor === undefined || held.id < cursor))
          .sort((first, second) => second.id.localeCompare(first.id))
          .slice(0, limit + 1)
          .map((held) => structuredClone(held));
        return Promise.resolve(pageOf(rows, { limit, cursorOf: (schedule) => schedule.id }));
      },
    },
    messages: {
      lockDailyCount: () => Promise.resolve(),
      countStoredOn: (fleetId, day) => Promise.resolve(state.messages.filter((message) => message.fleetId === fleetId && utcDayStart(message.createdAt).getTime() === day.getTime()).length),
      create: (message) => {
        if (
          state.messages.some(
            (held) =>
              held.fleetId === message.fleetId &&
              held.senderShipId === message.senderShipId &&
              held.idempotencyKey === message.idempotencyKey,
          )
        ) {
          return Promise.reject(new Error('unique violation: the sender already used this idempotency key'));
        }
        state.messages.push(structuredClone(message));
        return Promise.resolve();
      },
      lockIdempotencyKey: () => Promise.resolve(),
      findByIdempotencyKey: ({ fleetId, senderShipId, idempotencyKey }) => {
        const found = state.messages.find(
          (held) =>
            held.fleetId === fleetId && held.senderShipId === senderShipId && held.idempotencyKey === idempotencyKey,
        );
        return Promise.resolve(found && structuredClone(found));
      },
      find: (fleetId, messageId) => {
        const found = state.messages.find((held) => held.fleetId === fleetId && held.id === messageId);
        return Promise.resolve(found && structuredClone(found));
      },
    },
    deliveries: {
      create: (delivery) => {
        state.deliveries.push(structuredClone(delivery));
        return Promise.resolve();
      },
      findClaimableForUpdate: ({ fleetId, shipId, type, leaseId, limit, excluding, inReplyTo, shouldSkipHanded }) => {
        const isReplyAsked = (delivery: Delivery) =>
          inReplyTo === undefined || state.messages.some((held) => held.id === delivery.messageId && held.inReplyToMessageId === inReplyTo);
        const ofFleet = state.deliveries.filter((delivery) => delivery.fleetId === fleetId && isReplyAsked(delivery) && (!shouldSkipHanded || delivery.state !== 'handed'));
        const inFlight = ofFleet
          .filter(
            (delivery) =>
              isInFlight(delivery) && delivery.claimedByLeaseId === leaseId && !excluding.includes(delivery.id),
          )
          .sort(byAge);
        const pending = ofFleet
          .filter(
            ({ state: deliveryState, recipient, reachableShipIds }) =>
              deliveryState === 'pending' &&
              ((recipient.kind === 'ship' && recipient.shipId === shipId) ||
                (recipient.kind === 'type' && recipient.type === type && (reachableShipIds?.includes(shipId) ?? true))),
          )
          .sort(byAge);
        // Forced first (decision 0040), then in flight, then pending: a stable sort keeps each group oldest first.
        const claimable = [...inFlight, ...pending].sort(byForce).slice(0, limit).flatMap((delivery) => {
          const message = state.messages.find((held) => held.fleetId === fleetId && held.id === delivery.messageId);
          return message ? [{ delivery: structuredClone(delivery), message: structuredClone(message) }] : [];
        });
        return Promise.resolve(claimable);
      },
      countReceivable: ({ fleetId, shipId, type, leaseId }) => {
        const isPendingFor = (delivery: Delivery) =>
          delivery.state === 'pending' &&
          ((delivery.recipient.kind === 'ship' && delivery.recipient.shipId === shipId) ||
            (delivery.recipient.kind === 'type' && delivery.recipient.type === type && (delivery.reachableShipIds?.includes(shipId) ?? true)));
        const ofFleet = state.deliveries.filter((delivery) => delivery.fleetId === fleetId);
        const waiting = ofFleet.filter((delivery) => (isInFlight(delivery) && delivery.claimedByLeaseId === leaseId) || isPendingFor(delivery));
        const forced = waiting.filter((delivery) => delivery.isForced && (delivery.state === 'received' || isPendingFor(delivery)));
        return Promise.resolve({ waiting: waiting.length, forced: forced.length });
      },
      findForUpdate: (fleetId, deliveryId) => {
        const found = state.deliveries.find((held) => held.fleetId === fleetId && held.id === deliveryId);
        return Promise.resolve(found && structuredClone(found));
      },
      find: (fleetId, deliveryId) => {
        const found = state.deliveries.find((held) => held.fleetId === fleetId && held.id === deliveryId);
        return Promise.resolve(found && structuredClone(found));
      },
      findOfMessageReaching: (fleetId, { messageId, shipId }) => {
        const found = state.deliveries.find(
          (held) =>
            held.fleetId === fleetId &&
            held.messageId === messageId &&
            ((held.recipient.kind === 'ship' && held.recipient.shipId === shipId) || held.claimedByShipId === shipId),
        );
        return Promise.resolve(found && structuredClone(found));
      },
      findOpenPing: (fleetId, shipId) => {
        const open = state.deliveries.find(
          (delivery) =>
            delivery.fleetId === fleetId &&
            delivery.recipient.kind === 'ship' &&
            delivery.recipient.shipId === shipId &&
            (delivery.state === 'pending' || isInFlight(delivery)) &&
            state.messages.some((message) => message.id === delivery.messageId && message.contentType === PING_CONTENT_TYPE),
        );
        const message = open && state.messages.find((held) => held.id === open.messageId);
        return Promise.resolve(message && structuredClone(message));
      },
      update: (delivery) => {
        const index = state.deliveries.findIndex((held) => held.fleetId === delivery.fleetId && held.id === delivery.id);
        if (index === -1) {
          return Promise.reject(new Error(`no delivery ${delivery.id} to update`));
        }
        state.deliveries[index] = structuredClone(delivery);
        return Promise.resolve();
      },
      markRead: ({ fleetId, deliveryId, at }) => {
        if (!state.deliveryReads.some((read) => read.fleetId === fleetId && read.deliveryId === deliveryId)) {
          state.deliveryReads.push({ fleetId, deliveryId, readAt: at });
        }
        return Promise.resolve();
      },
      markUnread: ({ fleetId, deliveryId }) => {
        const index = state.deliveryReads.findIndex((read) => read.fleetId === fleetId && read.deliveryId === deliveryId);
        if (index !== -1) {
          state.deliveryReads.splice(index, 1);
        }
        return Promise.resolve();
      },
    },
    events: {
      append: (event) => {
        state.events.push({ ...event });
        return Promise.resolve();
      },
    },
    overdueDeliveries: {
      tell: (overdue, at) => {
        const { delivery: waiting, ...told } = overdue;
        const delivery = state.deliveries.find((held) => held.fleetId === told.fleetId && held.id === waiting.deliveryId);
        const isStill = delivery?.state === waiting.state && (waiting.state === 'pending' || delivery.claimedByLeaseId === told.leaseId);
        const isTold = state.overdueDeliveries.some((held) => held.fleetId === told.fleetId && held.leaseId === told.leaseId && held.deliveryId === waiting.deliveryId);
        if (!isStill || isTold) {
          return Promise.resolve(false);
        }
        state.overdueDeliveries.push({ ...told, deliveryId: waiting.deliveryId, state: waiting.state, at });
        return Promise.resolve(true);
      },
    },
    signInTickets: {
      create: (ticket) => {
        state.signInTickets.push({ ...ticket });
        return Promise.resolve();
      },
      redeem: (tokenHash, at) => {
        const ticket = state.signInTickets.find((held) => held.tokenHash === tokenHash && held.usedAt === null && held.expiresAt > at);
        if (!ticket) {
          return Promise.resolve(undefined);
        }
        ticket.usedAt = at;
        return Promise.resolve({ fleetId: ticket.fleetId, as: ticket.as, accountId: ticket.accountId });
      },
    },
    installationSettings: installationSettingsRepository,
    installationRequests: {
      lock: () => Promise.resolve(),
      find: (requestId) => {
        const request = state.installationRequests.find((held) => held.requestId === requestId);
        return Promise.resolve(request && { ...request });
      },
      record: (request) => {
        state.installationRequests.push({ ...request });
        return Promise.resolve();
      },
    },
    notifier: {
      deliveryPending: (notice) => {
        state.notices.push(structuredClone(notice));
        return Promise.resolve();
      },
    },
    scheduleNotifier: {
      scheduleDue: (notice) => {
        state.scheduleNotices.push(structuredClone(notice));
        return Promise.resolve();
      },
    },
  };

  // One unit of work at a time, like serialised transactions.
  let queue: Promise<unknown> = Promise.resolve();
  const uow: UnitOfWork<InMemoryTx> = {
    run: (work) => {
      const run = queue.then(async () => {
        const snapshot = structuredClone(state);
        try {
          const result = await work(tx);
          if (!result.isOk) {
            restore(state, snapshot);
          }
          return result;
        } catch (error) {
          restore(state, snapshot);
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };

  const markSeen = (lease: Lease, at: Date) => {
    const seen = state.leaseSeen.find((held) => held.leaseId === lease.id);
    if (seen) {
      seen.at = at;
    } else {
      state.leaseSeen.push({ fleetId: lease.fleetId, leaseId: lease.id, at });
    }
  };

  const callers: CallerLookup = {
    byCrewTokenHash: (crewTokenHash, { at }) => {
      const lease = state.leases.find((held) => held.crewTokenHash === crewTokenHash);
      const owner = lease && ship(lease.fleetId, lease.shipId);
      if (!lease || owner?.retiredAt !== null) {
        return Promise.resolve(undefined);
      }
      if (lease.endedAt === null) {
        markSeen(lease, at);
      }
      return Promise.resolve(
        lease.endedAt === null
          ? { isOpen: true, crew: { ...authenticated(owner), leaseId: lease.id } }
          : { isOpen: false },
      );
    },
    useConsoleSession: ({ tokenHash, now: at }) => {
      const session = state.consoleSessions.find(
        (held) => held.tokenHash === tokenHash && held.endedAt === null && held.expiresAt > at,
      );
      const owner = session && ship(session.fleetId, session.shipId);
      if (!session || !owner) {
        return Promise.resolve(undefined);
      }
      const renewed = at.getTime() + session.idleLimitMs;
      const expiresAt = new Date(Math.max(session.expiresAt.getTime(), Math.min(renewed, session.endsBy?.getTime() ?? renewed)));
      session.lastUsedAt = at;
      session.expiresAt = expiresAt;
      const lease = state.leases.find((held) => held.id === session.leaseId);
      if (lease) {
        markSeen(lease, at);
      }
      const caller = { ...authenticated(owner), consoleSessionId: session.id, ...(session.accountId === null ? {} : { signedInAccountId: session.accountId }) };
      return Promise.resolve({ caller: session.leaseId === null ? caller : { ...caller, leaseId: session.leaseId }, expiresAt });
    },
    consoleSessionEnding: (tokenHash) =>
      Promise.resolve(state.consoleSessions.find((held) => held.tokenHash === tokenHash)?.endReason ?? undefined),
  };

  const accounts: OperatorAccountLookup = {
    byEmail: (email) => {
      const account = state.operatorAccounts.find((held) => held.email === email);
      return Promise.resolve(account && { ...account });
    },
    byFleet: (fleetId) => {
      const account = state.operatorAccounts.find((held) => held.fleetId === fleetId);
      return Promise.resolve(account && { ...account });
    },
  };

  const lastPingOf = (held: Ship): ShipFacts['lastPing'] => {
    const pings = state.messages.filter(
      (message) =>
        message.fleetId === held.fleetId &&
        message.contentType === PING_CONTENT_TYPE &&
        message.selector.kind === 'ship' &&
        message.selector.shipId === held.id,
    );
    const newest = pings.at(-1);
    const delivery = newest && state.deliveries.find((stored) => stored.messageId === newest.id);
    if (!newest || !delivery) {
      return null;
    }
    const pong = state.events.find(
      (event) => event.type === 'DeliveryAcknowledged' && event.deliveryId === delivery.id && event.details.answer === 'pong',
    );
    return { sentAt: newest.createdAt, deliveryState: delivery.state, answeredWithPongAt: pong?.occurredAt ?? null };
  };

  const lastModelOf = (held: Ship): ShipFacts['lastModel'] => {
    const stated = state.messages.filter(
      (message) => message.fleetId === held.fleetId && message.senderShipId === held.id && message.model !== null && message.resendOfMessageId === null,
    );
    const newest = stated.at(-1);
    return newest?.model ? { id: newest.model, statedAt: newest.createdAt } : null;
  };

  const assigneeOf = (held: Ship): ShipFacts['crewRequestAssignee'] => {
    const assignedTo = state.crewRequests.find((request) => request.fleetId === held.fleetId && request.shipId === held.id)?.assignedTo;
    const assignee = state.ships.find((each) => each.fleetId === held.fleetId && each.id === assignedTo);
    return assignee ? { id: assignee.id, name: assignee.name } : null;
  };
  const crewedByOf = (held: Ship, lease: Lease | undefined): ShipFacts['crewedBy'] => {
    if (!lease) {
      return null;
    }
    const [prompt] = state.events
      .filter((event) => event.fleetId === held.fleetId && event.shipId === held.id && event.type === 'StartingPromptIssued' && event.occurredAt <= lease.startedAt)
      .reverse();
    const actorShipId = prompt?.actor.kind === 'ship' ? prompt.actor.shipId : undefined;
    const actor = state.ships.find((each) => each.fleetId === held.fleetId && each.id === actorShipId);
    return actor ? { id: actor.id, name: actor.name } : null;
  };
  const ownerOf = (held: Ship): ShipFacts['owner'] => {
    const owner = state.ships.find((each) => each.fleetId === held.fleetId && each.id === held.owner);
    return owner ? { id: owner.id, name: owner.name } : null;
  };
  const factsOf = (held: Ship): ShipFacts => {
    const secret = state.credentials.find((credential) => credential.shipId === held.id && credential.invalidatedAt === null);
    const lease = state.leases.find((open) => open.shipId === held.id && open.endedAt === null);
    return {
      ship: { ...held },
      owner: ownerOf(held),
      openLease: lease
        ? {
            location: { ...lease.location },
            harness: lease.harness,
            startedAt: lease.startedAt,
            lastSeenAt: state.leaseSeen.find((seen) => seen.leaseId === lease.id)?.at ?? lease.startedAt,
            report: state.leaseReports.find((held) => held.leaseId === lease.id)?.report ?? null,
          }
        : null,
      validSecret: secret ? { issuedAt: secret.issuedAt, claimedAt: secret.claimedAt } : null,
      crewRequest: state.crewRequests.find((request) => request.fleetId === held.fleetId && request.shipId === held.id) ?? null,
      crewRequestAssignee: assigneeOf(held),
      crewRequestGivenBack: (state.crewRequests.find((request) => request.fleetId === held.fleetId && request.shipId === held.id)?.givenBack ?? []).map(
        ({ trierarchShipId, ...back }) => ({ trierarch: { id: trierarchShipId, name: state.ships.find((each) => each.fleetId === held.fleetId && each.id === trierarchShipId)?.name ?? '' }, ...back }),
      ),
      labels: state.shipLabels
        .filter((carried) => carried.fleetId === held.fleetId && carried.shipId === held.id)
        .flatMap((carried) => {
          const label = state.labels.find((each) => each.id === carried.labelId);
          const value = label?.values.find((each) => each.id === carried.valueId);
          return label && value ? [{ labelId: label.id, key: label.key, valueId: value.id, value: value.value }] : [];
        })
        .sort((first, second) => first.key.localeCompare(second.key) || first.value.localeCompare(second.value)),
      crewedBy: crewedByOf(held, lease),
      lastPing: lastPingOf(held),
      lastModel: lastModelOf(held),
      lastViewedAt:
        state.consoleSessions
          .filter((session) => session.shipId === held.id && session.leaseId === null)
          .map((session) => session.lastUsedAt)
          .sort((first, second) => second.getTime() - first.getTime())[0] ?? null,
      lastLeaseEndedAt:
        state.leases
          .filter((ended) => ended.shipId === held.id && ended.endedAt !== null)
          .map((ended) => ended.endedAt)
          .filter((endedAt) => endedAt !== null)
          .sort((first, second) => second.getTime() - first.getTime())[0] ?? null,
    };
  };
  /** The oldest time of the given ones; null for none. */
  const oldestOf = (times: Date[]): Date | null => (times.length === 0 ? null : new Date(Math.min(...times.map((time) => time.getTime()))));
  const healthOf = (fleetId: FleetId): FleetHealth => {
    const deliveries = state.deliveries.filter((delivery) => delivery.fleetId === fleetId);
    const pending = deliveries.filter((delivery) => delivery.state === 'pending');
    const canTake = (delivery: Delivery): boolean => {
      const { recipient } = delivery;
      if (recipient.kind === 'ship') {
        return true;
      }
      return state.ships.some(
        (held) =>
          held.fleetId === fleetId &&
          held.type === recipient.type &&
          held.retiredAt === null &&
          (delivery.reachableShipIds === undefined || delivery.reachableShipIds.length === 0 || delivery.reachableShipIds.includes(held.id)),
      );
    };
    return {
      oldestPendingAt: oldestOf(pending.map((delivery) => delivery.createdAt)),
      oldestInFlightAt: oldestOf(deliveries.filter(isInFlight).map(stateSince)),
      noShipCanTake: pending.filter((delivery) => !canTake(delivery)).length,
      needsAttention: deliveries.filter((delivery) => delivery.state === 'undeliverable').length,
      overdue: state.overdueDeliveries.filter((told) => {
        const delivery = deliveries.find((held) => held.id === told.deliveryId);
        const lease = state.leases.find((held) => held.fleetId === fleetId && held.id === told.leaseId);
        return told.fleetId === fleetId && lease?.endedAt === null && delivery?.state === told.state && (told.state === 'pending' || delivery.claimedByLeaseId === told.leaseId);
      }).length,
    };
  };
  const installationFactsOf = (fleet: Fleet, window: InstallationFleetWindow): InstallationFleetFacts => {
    const times = state.events.filter((event) => event.fleetId === fleet.id).map((event) => event.occurredAt.getTime());
    return {
      fleetId: fleet.id,
      name: fleet.name,
      operatorEmail: state.operatorAccounts.find((account) => account.fleetId === fleet.id)?.email ?? '',
      createdAt: fleet.createdAt,
      shipCount: state.ships.filter((held) => held.fleetId === fleet.id && held.retiredAt === null).length,
      messagesSince: state.messages.filter((message) => message.fleetId === fleet.id && message.createdAt >= window.since).length,
      lastActivityAt: times.length === 0 ? null : new Date(Math.max(...times)),
      storage: state.messages.filter((message) => message.fleetId === fleet.id).reduce((bytes, message) => bytes + Buffer.byteLength(message.payload, 'utf8'), 0),
      messagesPerUtcDay: Object.entries(
        Object.groupBy(
          state.messages.filter((message) => message.fleetId === fleet.id && message.createdAt >= window.firstDay),
          (message) => message.createdAt.toISOString().slice(0, 10),
        ),
      ).map(([date, messages]) => ({ date, count: messages?.length ?? 0 })),
      limitSettings: state.fleetLimitSettings.find((held) => held.fleetId === fleet.id) ?? FOLLOWING_DEFAULTS,
      health: healthOf(fleet.id),
    };
  };
  const installationFleets: InstallationFleets = {
    list: (window) =>
      Promise.resolve(
        [...state.fleets].sort((one, other) => one.createdAt.getTime() - other.createdAt.getTime() || one.id.localeCompare(other.id)).map((fleet) => installationFactsOf(fleet, window)),
      ),
    find: (fleetId, window) => {
      const fleet = state.fleets.find((held) => held.id === fleetId);
      return Promise.resolve(fleet && installationFactsOf(fleet, window));
    },
  };

  const fleetLimitReads: FleetLimitReads = {
    applied: (fleetId) => appliedLimits(tx, fleetId),
    activeShips: (fleetId) => Promise.resolve(state.ships.filter((ship) => ship.fleetId === fleetId && ship.retiredAt === null).length),
    messagesOn: (fleetId, day) => Promise.resolve(state.messages.filter((message) => message.fleetId === fleetId && utcDayStart(message.createdAt).getTime() === day.getTime()).length),
    keptFrom: (fleetId) => Promise.resolve(state.fleetPrunes.find((row) => row.fleetId === fleetId)?.keptFrom ?? null),
  };

  const listing: FleetListing = {
    ships: (fleetId, { after, limit, filter, sort, reach }) =>
      Promise.resolve(
        state.ships
          .filter((held) => held.fleetId === fleetId)
          .map(factsOf)
          .filter((facts) => matchesShipFilter(listedShipOf(facts), { filter, isInReach: readsShip(reach, facts.ship.id) }))
          .map((facts) => ({ facts, position: positionOf(listedShipOf(facts), { sort, isInReach: readsShip(reach, facts.ship.id) }) }))
          .filter(({ position }) => after === undefined || comparePositions(sort)(position, after) > 0)
          .sort((first, second) => comparePositions(sort)(first.position, second.position))
          .slice(0, limit),
      ),
    ship: (fleetId, shipId) => {
      const held = state.ships.find((candidate) => candidate.fleetId === fleetId && candidate.id === shipId);
      return Promise.resolve(held && factsOf(held));
    },
    counts: (fleetId, { reach, filter }) =>
      Promise.resolve(
        shipCountsOf(
          state.ships
            .filter((held) => held.fleetId === fleetId && readsShip(reach, held.id))
            .map((held) => listedShipOf(factsOf(held)))
            .filter((listed) => matchesShipFilter(listed, { filter, isInReach: true })),
        ),
      ),
    types: (fleetId, { reach, status }) =>
      Promise.resolve(
        [
          ...new Set(
            state.ships
              .filter((held) => held.fleetId === fleetId && readsShip(reach, held.id))
              .map((held) => listedShipOf(factsOf(held)))
              .filter((listed) => status.includes(listed.status))
              .map((listed) => listed.type),
          ),
        ].toSorted(),
      ),
    labels: (fleetId) =>
      Promise.resolve(
        state.labels
          .filter((label) => label.fleetId === fleetId)
          .sort((first, second) => first.key.localeCompare(second.key))
          .map((label): ListedLabel => {
            const { owner } = label;
            const values = label.values.map((value) => ({ ...value }));
            if (owner.kind === 'installation') {
              return { id: label.id, key: label.key, values, owner };
            }
            const ship = state.ships.find((each) => each.fleetId === fleetId && each.id === owner.shipId);
            return { id: label.id, key: label.key, values, owner: { kind: 'ship', id: owner.shipId, name: ship?.name ?? '' } };
          }),
      ),
    labelShipCounts: (fleetId, reach) => {
      const values = new Map<ShipLabel['valueId'], number>();
      const carriers = new Map<ShipLabel['labelId'], Set<ShipLabel['shipId']>>();
      for (const carried of state.shipLabels) {
        const ship = state.ships.find((each) => each.fleetId === fleetId && each.id === carried.shipId);
        if (carried.fleetId === fleetId && ship?.retiredAt === null && readsShip(reach, carried.shipId)) {
          values.set(carried.valueId, (values.get(carried.valueId) ?? 0) + 1);
          carriers.set(carried.labelId, new Set([...(carriers.get(carried.labelId) ?? []), carried.shipId]));
        }
      }
      return Promise.resolve({ values, labels: new Map([...carriers].map(([labelId, ships]) => [labelId, ships.size])) });
    },
    deliveryCounts: (fleetId, shipId) => {
      const ofFleet = state.deliveries.filter((delivery) => delivery.fleetId === fleetId);
      return Promise.resolve({
        inFlight: ofFleet.filter((delivery) => isInFlight(delivery) && delivery.claimedByShipId === shipId).length,
        open: ofFleet.filter(
          (delivery) =>
            (delivery.state === 'pending' || isInFlight(delivery)) &&
            delivery.recipient.kind === 'ship' &&
            delivery.recipient.shipId === shipId,
        ).length,
      });
    },
    statement: (fleetId, shipId) => {
      const lease = state.leases.find((held) => held.fleetId === fleetId && held.shipId === shipId && held.endedAt === null);
      const held = lease && state.leaseStatements.find((each) => each.leaseId === lease.id);
      return Promise.resolve(held ? structuredClone(held.stated) : null);
    },
  };


  /**
   * A watch that runs each wait's step when one is queued, and otherwise lets
   * the wait pass on the clock: the receiver wake-ups and the fleet news alike.
   */
  const recordedWatches = <Address>(watched: Address[]) => {
    const waits: number[] = [];
    const nextWaits: (() => Promise<'woken' | 'timedOut'>)[] = [];
    let watches = 0;
    return {
      watched,
      waits,
      nextWaits,
      watching: () => watches,
      watch: (address: Address) => {
        watched.push(address);
        watches += 1;
        let isStopped = false;
        return {
          next: (waitMs: number) => {
            waits.push(waitMs);
            const step = nextWaits.shift();
            if (step) {
              return step();
            }
            clock.advance(waitMs);
            return Promise.resolve<'woken' | 'timedOut'>('timedOut');
          },
          stop: () => {
            if (!isStopped) {
              isStopped = true;
              watches -= 1;
            }
          },
        };
      },
    };
  };
  const receiverWatches = recordedWatches<ReceiverAddress>([]);
  const wakeups: InMemoryWakeups = { ...receiverWatches, watch: (address) => receiverWatches.watch({ ...address }) };
  const fleetNews: InMemoryFleetNews = recordedWatches<FleetId>([]);

  const numbered = (fleetId: FleetId) => numberedEvents(state, fleetId);
  const feed: FleetEventFeed = {
    lastSeq: (fleetId) =>
      Promise.resolve(Math.max(numbered(fleetId).at(-1)?.seq ?? 0, ...state.prunedEventSeqs.filter((row) => row.fleetId === fleetId).map((row) => row.seq))),
    after: (fleetId, { seq, limit }) => Promise.resolve(numbered(fleetId).slice(seq, seq + limit)),
  };

  const partyOf = (fleetId: FleetId, shipId: ShipId): HistoryParty => {
    const found = ship(fleetId, shipId);
    if (!found) {
      throw new Error(`no ship ${shipId}`);
    }
    return { id: found.id, name: found.name };
  };
  const labelValueOf = (fleetId: FleetId, valueId: LabelValueId): HistoryLabelValue => {
    const label = state.labels.find((held) => held.fleetId === fleetId && held.values.some((value) => value.id === valueId));
    const value = label?.values.find((held) => held.id === valueId);
    return label && value ? { valueId, key: label.key, value: value.value } : { valueId, key: null, value: null };
  };
  const recipientOf = (fleetId: FleetId, recipient: Addressee): HistoryRecipient => {
    switch (recipient.kind) {
      case 'ship':
        return { kind: 'ship', ship: partyOf(fleetId, recipient.shipId) };
      case 'label':
        return { kind: 'label', values: recipient.valueIds.map((valueId) => labelValueOf(fleetId, valueId)) };
      case 'type':
      case 'meeting':
        return recipient;
    }
  };
  const messageOf = (fleetId: FleetId, messageId: FleetEvent['messageId']): Message | undefined =>
    state.messages.find((held) => held.fleetId === fleetId && held.id === messageId);
  /** A message's first delivery by id: its only one, but for a send to a label (decision 0065). */
  const deliveryOfMessage = (message: Message): Delivery => {
    const found = state.deliveries.filter((held) => held.messageId === message.id).toSorted((first, second) => first.id.localeCompare(second.id))[0];
    if (!found) {
      throw new Error(`no delivery of ${message.id}`);
    }
    return found;
  };
  const timelineEntryOf = (event: SequencedEvent): TimelineEntry => {
    const message = event.messageId === undefined ? undefined : messageOf(event.fleetId, event.messageId);
    return {
      seq: event.seq,
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      actor: event.actor.kind === 'ship' ? partyOf(event.fleetId, event.actor.shipId) : null,
      signedInAccountId: event.actor.kind === 'ship' ? (event.actor.signedInAccountId ?? null) : null,
      ship: event.shipId === undefined ? null : partyOf(event.fleetId, event.shipId),
      message: message
        ? {
            id: message.id,
            sender: partyOf(message.fleetId, message.senderShipId),
            recipient: recipientOf(message.fleetId, message.selector),
            contentType: message.contentType,
            model: message.model,
          }
        : null,
      details: event.details,
    };
  };
  const historyMessageOf = (message: Message): HistoryMessage => {
    const delivery = deliveryOfMessage(message);
    return {
      id: message.id,
      sender: partyOf(message.fleetId, message.senderShipId),
      recipient: recipientOf(message.fleetId, message.selector),
      inReplyTo: message.inReplyToMessageId,
      sentAt: message.createdAt,
      contentType: message.contentType,
      model: message.model,
      payload: message.payload,
      delivery: {
        id: delivery.id,
        state: delivery.state,
        attempts: delivery.attempts,
        claimedBy: delivery.claimedByShipId === null ? null : partyOf(message.fleetId, delivery.claimedByShipId),
        handOverNumber: delivery.handOverNumber,
      },
    };
  };
  /** The messages to the ship itself, each with its delivery. */
  const inboxOf = (fleetId: FleetId, shipId: ShipId): { delivery: Delivery; message: Message }[] =>
    state.deliveries
      .filter((delivery) => delivery.fleetId === fleetId && delivery.recipient.kind === 'ship' && delivery.recipient.shipId === shipId)
      .flatMap((delivery) => {
        const message = messageOf(fleetId, delivery.messageId);
        return message ? [{ delivery, message }] : [];
      });
  /** A message to the ship itself as its inbox lists it. */
  const inboxEntryOf = (fleetId: FleetId, { shipId, delivery, message }: { shipId: ShipId; delivery: Delivery; message: Message }): InboxEntry => {
    const acknowledged = numbered(fleetId).findLast((event) => event.deliveryId === delivery.id && event.type === 'DeliveryAcknowledged');
    const reply = acknowledged?.details.reply;
    const { id, sender, inReplyTo, sentAt, contentType, model, payload } = historyMessageOf(message);
    return {
      deliveryId: delivery.id,
      state: delivery.state,
      readAt: state.deliveryReads.find((read) => read.deliveryId === delivery.id)?.readAt ?? null,
      doneAt: acknowledged?.occurredAt ?? null,
      repliedWith: typeof reply === 'string' ? idSchema('message').parse(reply) : null,
      replies: state.messages
        .filter((held) => held.fleetId === fleetId && held.senderShipId === shipId && held.inReplyToMessageId === message.id)
        .sort((first, second) => newestFirst(second, first))
        .map((held) => ({ id: held.id, contentType: held.contentType, payload: held.payload, sentAt: held.createdAt })),
      message: { id, sender, inReplyTo, sentAt, contentType, model, payload },
    };
  };
  /** What the history reads of a lease: its trierarch by the starting prompt its crew claimed with, push, turn and end. */
  const wayLeaseOf = (lease: Lease): WayLease => {
    const crewShip = ship(lease.fleetId, lease.shipId);
    const crewedBy = crewShip ? crewedByOf(crewShip, lease) : null;
    const isOperator = state.ships.some((held) => held.fleetId === lease.fleetId && held.id === crewedBy?.id && held.kind === 'operator');
    const revoked = state.events.find((event) => event.fleetId === lease.fleetId && event.type === 'LeaseRevoked' && event.details.leaseId === lease.id);
    const reason = revoked?.details.reason;
    const turn = state.leaseTurns.find((held) => held.fleetId === lease.fleetId && held.leaseId === lease.id)?.turn ?? null;
    return {
      location: { ...lease.location },
      harness: lease.harness,
      trierarch: crewedBy && !isOperator ? crewedBy : null,
      isPushed: state.pushedLeases.some((held) => held.fleetId === lease.fleetId && held.leaseId === lease.id),
      waker: state.pushedLeases.find((held) => held.fleetId === lease.fleetId && held.leaseId === lease.id)?.waker ?? null,
      isEnded: lease.endedAt !== null,
      endReason: LEASE_END_REASONS.find((known) => known === reason) ?? null,
      turn: turn && { ...turn },
    };
  };
  const wayLeases = (fleetId: FleetId): Map<string, WayLease> =>
    new Map(state.leases.filter((lease) => lease.fleetId === fleetId).map((lease) => [lease.id, wayLeaseOf(lease)]));
  /** The lease that holds the delivery, or the open lease of the one ship a pending delivery waits for. */
  const leaseOfDelivery = (delivery: Delivery): Lease | undefined => {
    if (delivery.claimedByLeaseId !== null) {
      return state.leases.find((lease) => lease.fleetId === delivery.fleetId && lease.id === delivery.claimedByLeaseId);
    }
    const { recipient } = delivery;
    return delivery.state === 'pending' && recipient.kind === 'ship'
      ? state.leases.find((lease) => lease.fleetId === delivery.fleetId && lease.shipId === recipient.shipId && lease.endedAt === null)
      : undefined;
  };
  /** The newest overdue clock argo was told of that still stands for the delivery. */
  const standingOverdueOf = (delivery: Delivery): StandingOverdue | null => {
    const told = state.overdueDeliveries
      .filter(
        (held) =>
          held.fleetId === delivery.fleetId &&
          held.deliveryId === delivery.id &&
          held.state === delivery.state &&
          state.leases.some((lease) => lease.id === held.leaseId && lease.endedAt === null) &&
          (held.state === 'pending' || delivery.claimedByLeaseId === held.leaseId),
      )
      .at(-1);
    return told ? { clock: told.clock, minutes: told.minutes, toldAt: told.at } : null;
  };
  const crewOf = (lease: Lease | undefined): WayCrew | null => {
    const request = lease && state.crewRequests.find((held) => held.fleetId === lease.fleetId && held.shipId === lease.shipId);
    return request?.status ? { status: request.status, attempt: request.attempt, startedAt: request.sessionStartedAt } : null;
  };
  const newestFirst = (first: Message, second: Message) =>
    second.createdAt.getTime() - first.createdAt.getTime() || second.id.localeCompare(first.id);
  const history: ShipHistory = {
    timeline: (fleetId, { shipId, cursor, limit }) => {
      if (!ship(fleetId, shipId)) {
        return Promise.resolve(undefined);
      }
      const events = numbered(fleetId);
      // An event the fleet does not have starts no page: nothing comes after it.
      const before = cursor === undefined ? Number.POSITIVE_INFINITY : (events.find((event) => event.id === cursor)?.seq ?? 0);
      const rows = events
        .filter((event) => event.seq < before && (event.shipId === shipId || (event.actor.kind === 'ship' && event.actor.shipId === shipId)))
        .reverse()
        .slice(0, limit + 1)
        .map(timelineEntryOf);
      return Promise.resolve(pageOf(rows, { limit, cursorOf: (entry) => entry.id }));
    },
    messages: (fleetId, { shipId, cursor, limit }) => {
      if (!ship(fleetId, shipId)) {
        return Promise.resolve(undefined);
      }
      const claimed = new Set(
        state.events
          .filter((event) => event.fleetId === fleetId && event.type === 'DeliveryHanded' && event.shipId === shipId)
          .map((event) => event.messageId),
      );
      const rows = state.messages
          .filter(
            (message) =>
              message.fleetId === fleetId &&
              message.selector.kind !== 'meeting' &&
              (message.senderShipId === shipId ||
                (message.selector.kind === 'ship' && message.selector.shipId === shipId) ||
                claimed.has(message.id)) &&
              (cursor === undefined || message.id < cursor),
          )
          .sort((first, second) => second.id.localeCompare(first.id))
          .slice(0, limit + 1)
          .map(historyMessageOf);
      return Promise.resolve(pageOf(rows, { limit, cursorOf: (message) => message.id }));
    },
    message: (fleetId, messageId) => {
      const message = messageOf(fleetId, messageId);
      if (!message) {
        return Promise.resolve(undefined);
      }
      const delivery = deliveryOfMessage(message);
      const leases = wayLeases(fleetId);
      const changes = numbered(fleetId)
        .filter((event) => event.deliveryId === delivery.id)
        .reverse()
        .flatMap((event) => deliveryStepOf(event, { party: (id) => partyOf(fleetId, id), leases }));
      const replies = state.messages
        .filter((held) => held.fleetId === fleetId && held.inReplyToMessageId === message.id)
        .toSorted((first, second) => first.createdAt.getTime() - second.createdAt.getTime() || first.id.localeCompare(second.id))
        .map((reply) => ({ id: reply.id, sender: partyOf(fleetId, reply.senderShipId), sentAt: reply.createdAt }));
      const lease = leaseOfDelivery(delivery);
      return Promise.resolve({
        ...historyMessageOf(message),
        history: changes,
        deliveryCount: state.deliveries.filter((held) => held.fleetId === fleetId && held.messageId === message.id).length,
        replies,
        lease: lease ? wayLeaseOf(lease) : null,
        overdue: standingOverdueOf(delivery),
        crew: crewOf(lease),
      });
    },
    messageDeliveries: (fleetId, { messageId, cursor, limit }) => {
      const leases = wayLeases(fleetId);
      const page = pageOf(
        state.deliveries
          .filter((held) => held.fleetId === fleetId && held.messageId === messageId && (cursor === undefined || held.id > cursor))
          .toSorted((first, second) => first.id.localeCompare(second.id)),
        { limit, cursorOf: (held) => held.id },
      );
      return Promise.resolve({
        items: page.items.map((held) => {
          const shipId = held.recipient.kind === 'ship' ? held.recipient.shipId : held.claimedByShipId;
          return {
            id: held.id,
            ship: shipId === null ? null : partyOf(fleetId, shipId),
            state: held.state,
            steps: numbered(fleetId)
              .filter((event) => event.deliveryId === held.id)
              .reverse()
              .flatMap((event) => deliveryStepOf(event, { party: (id) => partyOf(fleetId, id), leases })),
          };
        }),
        nextCursor: page.nextCursor,
      });
    },
    messageParties: (fleetId, messageIds) =>
      Promise.resolve(
        new Map(
          state.deliveries
            .filter((delivery) => delivery.fleetId === fleetId && messageIds.includes(delivery.messageId))
            .flatMap((delivery) => {
              const message = messageOf(fleetId, delivery.messageId);
              return message ? [[message.id, { senderId: message.senderShipId, recipient: delivery.recipient, claimedBy: delivery.claimedByShipId }] as const] : [];
            }),
        ),
      ),
    openInboxCount: (fleetId, { shipId, senderIds }) =>
      Promise.resolve(
        state.deliveries.filter((delivery) => {
          const senderId = messageOf(fleetId, delivery.messageId)?.senderShipId;
          return (
            delivery.fleetId === fleetId &&
            delivery.recipient.kind === 'ship' &&
            delivery.recipient.shipId === shipId &&
            isKeptBy('open', delivery.state) &&
            (senderIds === undefined || (senderId !== undefined && senderIds.has(senderId)))
          );
        }).length,
      ),
    inbox: (fleetId, { shipId, filter, cursor, limit }) =>
      Promise.resolve(
        inboxOf(fleetId, shipId)
          .filter(({ delivery }) => isKeptBy(filter, delivery.state) && (cursor === undefined || delivery.id < cursor))
          .sort((first, second) => second.delivery.id.localeCompare(first.delivery.id))
          .slice(0, limit + 1)
          .map(({ delivery, message }) => inboxEntryOf(fleetId, { shipId, delivery, message })),
      ).then((rows) => pageOf(rows, { limit, cursorOf: (entry) => entry.deliveryId })),
    inboxMessage: (fleetId, { shipId, deliveryId }) => {
      const found = inboxOf(fleetId, shipId).find(({ delivery }) => delivery.id === deliveryId);
      return Promise.resolve(found ? inboxEntryOf(fleetId, { shipId, ...found }) : undefined);
    },
    inboxWithdrawals: (fleetId, { shipId, questionId, cursor, limit }) =>
      Promise.resolve(
        inboxOf(fleetId, shipId)
          .filter(({ delivery, message }) => withdrawalOf(message)?.questionId === questionId && (cursor === undefined || delivery.id > cursor))
          .sort((first, second) => first.delivery.id.localeCompare(second.delivery.id))
          .slice(0, limit + 1)
          .map(({ delivery, message }) => inboxEntryOf(fleetId, { shipId, delivery, message })),
      ).then((rows) => pageOf(rows, { limit, cursorOf: (entry) => entry.deliveryId })),
    needsAttention: (fleetId, { shipId, state: asked, cursor, limit }) => {
      const events = numbered(fleetId);
      const sinceOf = (deliveryId: DeliveryId) =>
        events.findLast((event) => event.deliveryId === deliveryId && (event.type === 'DeliveryUndeliverable' || event.type === 'DeliveryNotHandled'));
      // A delivery the fleet never listed starts no page: nothing comes after it.
      const after = cursor === undefined ? 0 : (sinceOf(cursor)?.seq ?? Number.POSITIVE_INFINITY);
      return Promise.resolve(
        state.deliveries
          .filter((delivery) => delivery.fleetId === fleetId)
          .flatMap((delivery) => (delivery.state === 'undeliverable' || delivery.state === 'notHandled' ? [{ delivery, state: delivery.state }] : []))
          .map(({ delivery, state: attentionState }) => {
            const message = messageOf(fleetId, delivery.messageId);
            const since = sinceOf(delivery.id);
            if (!message || !since?.shipId) {
              throw new Error(`${attentionState} ${delivery.id} without its message or its event by a ship`);
            }
            const { id, sender, recipient, inReplyTo, sentAt, contentType, model, payload } = historyMessageOf(message);
            return {
              seq: since.seq,
              entry: {
                deliveryId: delivery.id,
                state: attentionState,
                attempts: delivery.attempts,
                isPushed: delivery.handOverNumber !== null,
                since: since.occurredAt,
                reason: typeof since.details.reason === 'string' ? since.details.reason : null,
                ship: partyOf(fleetId, since.shipId),
                message: { id, sender, recipient, inReplyTo, sentAt, contentType, model, payload },
              },
            };
          })
          .filter(({ seq, entry }) => seq > after && (shipId === undefined || entry.ship.id === shipId) && (asked === undefined || entry.state === asked))
          .sort((first, second) => first.seq - second.seq)
          .slice(0, limit + 1)
          .map(({ entry }) => entry),
      ).then((rows) => pageOf(rows, { limit, cursorOf: (entry) => entry.deliveryId }));
    },
    shipWay: (fleetId, shipId) => {
      const crewed = ship(fleetId, shipId);
      if (!crewed) {
        return Promise.resolve(undefined);
      }
      const lease = state.leases.find((held) => held.fleetId === fleetId && held.shipId === shipId && held.endedAt === null);
      if (!lease) {
        return Promise.resolve({ lease: null, waiting: [] });
      }
      const waitsForIt = (delivery: Delivery): boolean => {
        if (delivery.state === 'received' || delivery.state === 'handed') {
          return delivery.claimedByLeaseId === lease.id;
        }
        const { recipient, reachableShipIds = [] } = delivery;
        return (
          delivery.state === 'pending' &&
          (recipient.kind === 'ship'
            ? recipient.shipId === shipId
            : recipient.type === crewed.type && (reachableShipIds.length === 0 || reachableShipIds.includes(shipId)))
        );
      };
      const waiting = state.deliveries
        .filter((delivery) => delivery.fleetId === fleetId && waitsForIt(delivery))
        .flatMap((delivery) => {
          const message = messageOf(fleetId, delivery.messageId);
          return message ? [message] : [];
        })
        .toSorted((first, second) => first.createdAt.getTime() - second.createdAt.getTime() || first.id.localeCompare(second.id))
        .map((message) => message.id);
      return Promise.resolve({ lease: wayLeaseOf(lease), waiting });
    },
  };

  const notices: NoticeRepository = {
    read: () => Promise.resolve(structuredClone(state.installationNotices)),
    replace: (replacing) => {
      state.installationNotices.splice(0, state.installationNotices.length, ...structuredClone(replacing));
      return Promise.resolve();
    },
  };
  // A console session's and an account's are kept apart, as Postgres keeps them in two tables.
  const isSameSignIn = (one: ConsoleSignIn, other: ConsoleSignIn): boolean =>
    one.kind === 'account' ? other.kind === 'account' && one.accountId === other.accountId : other.kind !== 'account' && one.consoleSessionId === other.consoleSessionId;
  const noticeDismissals: NoticeDismissals = {
    dismissed: ({ fleetId, signIn }) =>
      Promise.resolve(state.noticeDismissals.filter((held) => held.fleetId === fleetId && isSameSignIn(held.signIn, signIn)).map((held) => held.noticeId)),
    dismiss: (dismissal) => {
      const isHeld = state.noticeDismissals.some((held) => held.fleetId === dismissal.fleetId && isSameSignIn(held.signIn, dismissal.signIn) && held.noticeId === dismissal.noticeId);
      if (!isHeld) {
        state.noticeDismissals.push({ ...dismissal });
      }
      return Promise.resolve();
    },
  };

  const guide: GuideRepository = {
    read: () => Promise.resolve(structuredClone(state.installationGuide)),
    replace: (replacing) => {
      state.installationGuide = structuredClone(replacing);
      return Promise.resolve();
    },
  };
  const guideProgress: GuideProgressRepository = {
    progress: ({ fleetId, signIn }) => {
      const held = state.guideProgress.find((each) => each.fleetId === fleetId && isSameSignIn(each.signIn, signIn));
      return Promise.resolve(held ? { step: held.step, state: held.state } : null);
    },
    record: (recording) => {
      const others = state.guideProgress.filter((each) => !(each.fleetId === recording.fleetId && isSameSignIn(each.signIn, recording.signIn)));
      state.guideProgress.splice(0, state.guideProgress.length, ...others, { ...recording });
      return Promise.resolve();
    },
  };

  /** When the delivery entered its state, as the event log has it: its latest return, receipt or hand-over, else its creation. */
  const stateSince = (delivery: Delivery): Date => {
    const entered = state.events.filter(
      (event) =>
        event.fleetId === delivery.fleetId &&
        event.deliveryId === delivery.id &&
        (event.type === 'DeliveryReturned' || (event.type === 'DeliveryReceived' && event.details.again !== true) || (event.type === 'DeliveryHanded' && event.details.onceMore !== true)),
    );
    return entered.at(-1)?.occurredAt ?? delivery.createdAt;
  };

  const pushedCrews: PushedCrews = {
    waiting: (fleetId) => {
      const crews = state.leases.flatMap((lease): PushedCrew[] => {
        const pushed = state.pushedLeases.find((held) => held.fleetId === fleetId && held.leaseId === lease.id);
        const crewShip = ship(fleetId, lease.shipId);
        if (lease.fleetId !== fleetId || lease.endedAt !== null || !pushed || !crewShip) {
          return [];
        }
        const isWaiting = (delivery: Delivery): delivery is Delivery & { state: WaitingDelivery['state'] } =>
          delivery.fleetId === fleetId &&
          ((isInFlight(delivery) && delivery.claimedByLeaseId === lease.id) ||
            (delivery.state === 'pending' &&
              ((delivery.recipient.kind === 'ship' && delivery.recipient.shipId === lease.shipId) ||
                (delivery.recipient.kind === 'type' && delivery.recipient.type === crewShip.type && (delivery.reachableShipIds?.includes(lease.shipId) ?? true)))));
        const turn = state.leaseTurns.find((held) => held.fleetId === fleetId && held.leaseId === lease.id)?.turn ?? null;
        return [
          {
            fleetId,
            shipId: lease.shipId,
            leaseId: lease.id,
            pushedAt: pushed.at,
            isPerson: crewShip.kind === 'person',
            turn: turn && { ...turn },
            waiting: state.deliveries.filter(isWaiting).map((delivery) => ({
              deliveryId: delivery.id,
              messageId: delivery.messageId,
              state: delivery.state,
              since: stateSince(delivery),
              sentAt: delivery.createdAt,
            })),
          },
        ];
      });
      return Promise.resolve(crews);
    },
  };

  const scheduleAttempts: ScheduleAttempts = {
    nextAttemptAt: (fleetId) => {
      const times = state.schedules.flatMap((held) => (held.fleetId === fleetId && held.state === 'active' && held.nextAttemptAt !== null ? [held.nextAttemptAt.getTime()] : []));
      return Promise.resolve(times.length === 0 ? undefined : new Date(Math.min(...times)));
    },
  };

  return { state, uow, fleets: tx.fleets, scheduleAttempts, pushedCrews, ships: tx.ships, leases: tx.leases, crewRequests: tx.crewRequests, clearRequests: tx.clearRequests, labels: tx.labels, reachRefusals: tx.reachRefusals, declaredNetworkRules: tx.declaredNetworkRules, scopeNamespaces: tx.scopeNamespaces, definedScopes: tx.definedScopes, callers, accounts, listing, installationFleets, installationSettings: installationSettingsRepository, fleetLimitReads, feed, history, health: healthRecords, healthSnapshots, notices, noticeDismissals, guide, guideProgress, clock, ids, hasher, passwords, random, wakeups, fleetNews };
}

/** The tables whose rows belong to a fleet by their fleet id: all but the fleets and the installation's requests. */
const FLEET_TABLES = [
  'healthSnapshots',
  'ships',
  'leases',
  'credentials',
  'operatorAccounts',
  'consoleSessions',
  'signInTickets',
  'messages',
  'meetings',
  'schedules',
  'scheduleNotices',
  'deliveries',
  'deliveryReads',
  'leaseSeen',
  'pushedLeases',
  'leaseReports',
  'leaseStatements',
  'leaseTurns',
  'crewRequests',
  'clearRequests',
  'labels',
  'shipLabels',
  'networkSettings',
  'declaredNetworkRules',
  'networkRulesDrafts',
  'scopeNamespaces',
  'definedScopes',
  'verifiedFacts',
  'reachRefusals',
  'events',
  'overdueDeliveries',
  'notices',
  'noticeDismissals',
  'guideProgress',
  'fleetLimitSettings',
  'fleetPrunes',
] as const satisfies readonly Exclude<keyof InMemoryState, 'fleets' | 'installationRequests' | 'installationSettings' | 'installationNotices' | 'installationGuide'>[];

const TABLES = [
  'healthSnapshots',
  'fleets',
  'ships',
  'leases',
  'credentials',
  'operatorAccounts',
  'consoleSessions',
  'signInTickets',
  'messages',
  'deliveries',
  'meetings',
  'schedules',
  'scheduleNotices',
  'deliveryReads',
  'leaseSeen',
  'pushedLeases',
  'leaseReports',
  'leaseStatements',
  'leaseTurns',
  'crewRequests',
  'clearRequests',
  'labels',
  'shipLabels',
  'networkSettings',
  'declaredNetworkRules',
  'networkRulesDrafts',
  'scopeNamespaces',
  'definedScopes',
  'verifiedFacts',
  'reachRefusals',
  'events',
  'overdueDeliveries',
  'installationRequests',
  'installationSettings',
  'fleetLimitSettings',
  'fleetPrunes',
  'notices',
] as const satisfies readonly (keyof InMemoryState)[];

/** Puts every table back as it was, keeping the arrays tests already hold. */
function restore(state: InMemoryState, snapshot: InMemoryState): void {
  for (const key of TABLES) {
    const rows: unknown[] = state[key];
    rows.splice(0, rows.length, ...snapshot[key]);
  }
}

function isClearRequestKey(held: ClearRequest, key: { trierarchShipId: ClearRequest['trierarchShipId']; shipId: ClearRequest['shipId']; repository: string }): boolean {
  return held.trierarchShipId === key.trierarchShipId && held.shipId === key.shipId && held.repository === key.repository;
}
