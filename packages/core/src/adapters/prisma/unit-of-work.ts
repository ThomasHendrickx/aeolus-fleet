import type {
  CallerLookup,
  ConsoleSessionRepository,
  CredentialRepository,
  OperatorAccountRepository,
  SignInTicketRepository,
} from '../../domain/identity/ports.js';
import type { DeliveryRepository, MessageRepository } from '../../domain/messaging/ports.js';
import type {
  CrewRequestRepository,
  FleetRepository,
  InFlightDeliveries,
  InstallationRequestRepository,
  InstallationSettingsRepository,
  LeaseRepository,
  ShipRepository,
} from '../../domain/registry/ports.js';
import type { Notifier } from '../../domain/shared/notifier.js';
import type { Result } from '../../domain/shared/result.js';
import type { UnitOfWork } from '../../domain/shared/unit-of-work.js';
import type { Db, PrismaClient } from './client.js';
import { createPrismaNotifier } from './delivery-notices.js';
import { createPrismaEventLog, type BufferedEventLog } from './event-log.js';
import {
  createPrismaCallerLookup,
  createPrismaConsoleSessionRepository,
  createPrismaCredentialRepository,
  createPrismaOperatorAccountRepository,
  createPrismaSignInTicketRepository,
} from './identity.js';
import { createPrismaInstallationRequestRepository, createPrismaInstallationSettings } from './installation.js';
import { createPrismaDeliveryRepository, createPrismaMessageRepository } from './messaging.js';
import {
  createPrismaCrewRequestRepository,
  createPrismaFleetRepository,
  createPrismaInFlightDeliveries,
  createPrismaLeaseRepository,
  createPrismaShipRepository,
} from './registry.js';

/** Every port a use case can ask for in its unit of work, bound to one transaction. */
export interface PrismaTx {
  fleets: FleetRepository;
  ships: ShipRepository;
  leases: LeaseRepository;
  crewRequests: CrewRequestRepository;
  inFlightDeliveries: InFlightDeliveries;
  credentials: CredentialRepository;
  operatorAccounts: OperatorAccountRepository;
  consoleSessions: ConsoleSessionRepository;
  signInTickets: SignInTicketRepository;
  messages: MessageRepository;
  deliveries: DeliveryRepository;
  events: BufferedEventLog;
  notifier: Notifier;
  installationRequests: InstallationRequestRepository;
  installationSettings: InstallationSettingsRepository;
}

export function createPrismaTx(db: Db): PrismaTx {
  return {
    fleets: createPrismaFleetRepository(db),
    ships: createPrismaShipRepository(db),
    leases: createPrismaLeaseRepository(db),
    crewRequests: createPrismaCrewRequestRepository(db),
    inFlightDeliveries: createPrismaInFlightDeliveries(db),
    credentials: createPrismaCredentialRepository(db),
    operatorAccounts: createPrismaOperatorAccountRepository(db),
    consoleSessions: createPrismaConsoleSessionRepository(db),
    signInTickets: createPrismaSignInTicketRepository(db),
    messages: createPrismaMessageRepository(db),
    deliveries: createPrismaDeliveryRepository(db),
    events: createPrismaEventLog(db),
    installationRequests: createPrismaInstallationRequestRepository(db),
    installationSettings: createPrismaInstallationSettings(db),
    notifier: createPrismaNotifier(db),
  };
}

/** Thrown inside the transaction only to roll a refused unit of work back. */
class Refused extends Error {
  override name = 'Refused';
}

/**
 * Runs each use case in one interactive transaction (read committed). Every
 * write, events included, commits together; the events are written last, so
 * their numbers follow commit order (event-log.ts). A refusal or a thrown error rolls
 * all of it back; Prisma rolls back only on a throw, so a refusal is thrown
 * inside the transaction and returned outside it.
 */
export function createPrismaUnitOfWork(prisma: PrismaClient): UnitOfWork<PrismaTx> {
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
          return result;
        });
      } catch (error) {
        if (error instanceof Refused && outcome.refusal) {
          return outcome.refusal;
        }
        throw error;
      }
    },
  };
}

/** Caller lookups run outside a unit of work: each is one statement. */
export function createPrismaCallers(prisma: PrismaClient): CallerLookup {
  return createPrismaCallerLookup(prisma);
}
