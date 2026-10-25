import type {
  CallerLookup,
  ConsoleSessionRepository,
  CredentialRepository,
  OperatorAccountRepository,
  SignInTicketRepository,
} from '../../domain/identity/ports.js';
import type { DeliveryRepository, MeetingRepository, OverdueDeliveryRepository, ScheduleNotifier, ScheduleRepository } from '../../domain/messaging/ports.js';
import type {
  ClearRequestRepository,
  CrewRequestRepository,
  FleetRepository,
  InFlightDeliveries,
  InstallationRequestRepository,
  InstallationSettingsRepository,
  LabelRepository,
  LeaseRepository,
  DeclaredNetworkRulesRepository,
  NetworkRulesDraftRepository,
  VerifiedFactsRepository,
  ScopeNamespaceRepository,
  NetworkSettingsRepository,
  ReachRefusalRepository,
  ShipRepository,
} from '../../domain/registry/ports.js';
import type { Notifier } from '../../domain/shared/notifier.js';
import type { Result } from '../../domain/shared/result.js';
import type { UnitOfWork } from '../../domain/shared/unit-of-work.js';
import type { HealthSnapshotWriter } from '../../domain/shared/health-snapshot.js';
import { BULK_TRANSACTION_TIME_MS, type Db, type PrismaClient } from './client.js';
import { createPrismaNotifier } from './delivery-notices.js';
import { createPrismaEventLog, type BufferedEventLog } from './event-log.js';
import { createPrismaHealthSnapshots } from './health-snapshots.js';
import {
  createPrismaCallerLookup,
  createPrismaConsoleSessionRepository,
  createPrismaCredentialRepository,
  createPrismaOperatorAccountRepository,
  createPrismaSignInTicketRepository,
} from './identity.js';
import { createPrismaInstallationRequestRepository, createPrismaInstallationSettings } from './installation.js';
import { createPrismaMeetingRepository } from './meetings.js';
import { createPrismaDeliveryRepository, createPrismaMessageRepository, type BufferedMessageRepository } from './messaging.js';
import { createPrismaOverdueDeliveryRepository } from './overdue.js';
import { createPrismaScheduleNotifier, createPrismaScheduleRepository } from './schedules.js';
import { createPrismaDeclaredNetworkRulesRepository, createPrismaNetworkRulesDraftRepository, createPrismaNetworkSettingsRepository, createPrismaReachRefusalRepository } from './network.js';
import { createPrismaVerifiedFactsRepository } from './verified-facts.js';
import { createPrismaScopeNamespaceRepository } from './scope-namespaces.js';
import {
  createPrismaClearRequestRepository,
  createPrismaCrewRequestRepository,
  createPrismaFleetRepository,
  createPrismaInFlightDeliveries,
  createPrismaLabelRepository,
  createPrismaLeaseRepository,
  createPrismaShipRepository,
} from './registry.js';

/** Every port a use case can ask for in its unit of work, bound to one transaction. */
export interface PrismaTx {
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
  verifiedFacts: VerifiedFactsRepository;
  reachRefusals: ReachRefusalRepository;
  inFlightDeliveries: InFlightDeliveries;
  credentials: CredentialRepository;
  operatorAccounts: OperatorAccountRepository;
  consoleSessions: ConsoleSessionRepository;
  signInTickets: SignInTicketRepository;
  messages: BufferedMessageRepository;
  deliveries: DeliveryRepository;
  meetings: MeetingRepository;
  schedules: ScheduleRepository;
  overdueDeliveries: OverdueDeliveryRepository;
  events: BufferedEventLog;
  notifier: Notifier;
  scheduleNotifier: ScheduleNotifier;
  installationRequests: InstallationRequestRepository;
  installationSettings: InstallationSettingsRepository;
  healthSnapshots: HealthSnapshotWriter;
}

export function createPrismaTx(db: Db): PrismaTx {
  return {
    fleets: createPrismaFleetRepository(db),
    ships: createPrismaShipRepository(db),
    leases: createPrismaLeaseRepository(db),
    crewRequests: createPrismaCrewRequestRepository(db),
    clearRequests: createPrismaClearRequestRepository(db),
    labels: createPrismaLabelRepository(db),
    networkSettings: createPrismaNetworkSettingsRepository(db),
    declaredNetworkRules: createPrismaDeclaredNetworkRulesRepository(db),
    networkRulesDrafts: createPrismaNetworkRulesDraftRepository(db),
    scopeNamespaces: createPrismaScopeNamespaceRepository(db),
    verifiedFacts: createPrismaVerifiedFactsRepository(db),
    reachRefusals: createPrismaReachRefusalRepository(db),
    inFlightDeliveries: createPrismaInFlightDeliveries(db),
    credentials: createPrismaCredentialRepository(db),
    operatorAccounts: createPrismaOperatorAccountRepository(db),
    consoleSessions: createPrismaConsoleSessionRepository(db),
    signInTickets: createPrismaSignInTicketRepository(db),
    messages: createPrismaMessageRepository(db),
    deliveries: createPrismaDeliveryRepository(db),
    meetings: createPrismaMeetingRepository(db),
    schedules: createPrismaScheduleRepository(db),
    overdueDeliveries: createPrismaOverdueDeliveryRepository(db),
    events: createPrismaEventLog(db),
    installationRequests: createPrismaInstallationRequestRepository(db),
    installationSettings: createPrismaInstallationSettings(db),
    notifier: createPrismaNotifier(db),
    scheduleNotifier: createPrismaScheduleNotifier(db),
    healthSnapshots: createPrismaHealthSnapshots(db),
  };
}

/** Thrown inside the transaction only to roll a refused unit of work back. */
class Refused extends Error {
  override name = 'Refused';
}

/**
 * Runs each use case in one interactive transaction (read committed). Every
 * write, events included, commits together; the events are written last, so
 * their numbers follow commit order (event-log.ts), and the messages are
 * counted on their days after them (messaging.ts). A refusal or a thrown error rolls
 * all of it back; Prisma rolls back only on a throw, so a refusal is thrown
 * inside the transaction and returned outside it.
 */
export function createPrismaUnitOfWork(prisma: PrismaClient): UnitOfWork<PrismaTx> {
  return createUnitOfWork(prisma, {});
}

/** The same unit of work for a bulk operation, such as a fleet delete: it may run up to BULK_TRANSACTION_TIME_MS. */
export function createPrismaBulkUnitOfWork(prisma: PrismaClient): UnitOfWork<PrismaTx> {
  return createUnitOfWork(prisma, { timeout: BULK_TRANSACTION_TIME_MS });
}

/**
 * The unit of work of the stuck snapshot's close: repeatable read, so the
 * events, ships, leases and deliveries it folds and replays are one moment's,
 * and the events up to a seq are all there; it may run as long as a bulk one.
 */
export function createPrismaSnapshotUnitOfWork(prisma: PrismaClient): UnitOfWork<PrismaTx> {
  return createUnitOfWork(prisma, { timeout: BULK_TRANSACTION_TIME_MS, isolationLevel: 'RepeatableRead' });
}

/** A unit of work whose transactions take the given options over the client's. */
function createUnitOfWork(prisma: PrismaClient, options: { timeout?: number; isolationLevel?: 'RepeatableRead' }): UnitOfWork<PrismaTx> {
  return {
    run: async <T, E>(work: (tx: PrismaTx) => Promise<Result<T, E>>): Promise<Result<T, E>> => {
      const outcome: { refusal?: Result<T, E> } = {};
      try {
        return await prisma.$transaction(async (tx) => {
          const unit = createPrismaTx(tx);
          const result = await work(unit);
          if (!result.isOk) {
            outcome.refusal = result;
            throw new Refused();
          }
          await unit.events.flush();
          await unit.messages.flush();
          return result;
        }, options);
      } catch (error) {
        if (error instanceof Refused && outcome.refusal) {
          return outcome.refusal;
        }
        throw error;
      }
    },
  };
}

/** ShipCaller lookups run outside a unit of work: each is one statement. */
export function createPrismaCallers(prisma: PrismaClient): CallerLookup {
  return createPrismaCallerLookup(prisma);
}
