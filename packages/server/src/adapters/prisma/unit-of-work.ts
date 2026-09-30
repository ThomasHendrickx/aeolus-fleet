import type {
  CallerLookup,
  ConsoleSessionRepository,
  CredentialRepository,
  OperatorAccountRepository,
} from '../../core/identity/ports.js';
import type { DeliveryRepository, MessageRepository, Notifier } from '../../core/messaging/ports.js';
import type {
  FleetRepository,
  InFlightDeliveries,
  LeaseRepository,
  ShipRepository,
} from '../../core/registry/ports.js';
import type { EventLog } from '../../core/shared/events.js';
import type { Result } from '../../core/shared/result.js';
import type { UnitOfWork } from '../../core/shared/unit-of-work.js';
import type { Db, PrismaClient } from './client.js';
import { createPrismaNotifier } from './delivery-notices.js';
import { createPrismaEventLog } from './event-log.js';
import {
  createPrismaCallerLookup,
  createPrismaConsoleSessionRepository,
  createPrismaCredentialRepository,
  createPrismaOperatorAccountRepository,
} from './identity.js';
import { createPrismaDeliveryRepository, createPrismaMessageRepository } from './messaging.js';
import {
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
  inFlightDeliveries: InFlightDeliveries;
  credentials: CredentialRepository;
  operatorAccounts: OperatorAccountRepository;
  consoleSessions: ConsoleSessionRepository;
  messages: MessageRepository;
  deliveries: DeliveryRepository;
  events: EventLog;
  notifier: Notifier;
}

export function createPrismaTx(db: Db): PrismaTx {
  return {
    fleets: createPrismaFleetRepository(db),
    ships: createPrismaShipRepository(db),
    leases: createPrismaLeaseRepository(db),
    inFlightDeliveries: createPrismaInFlightDeliveries(db),
    credentials: createPrismaCredentialRepository(db),
    operatorAccounts: createPrismaOperatorAccountRepository(db),
    consoleSessions: createPrismaConsoleSessionRepository(db),
    messages: createPrismaMessageRepository(db),
    deliveries: createPrismaDeliveryRepository(db),
    events: createPrismaEventLog(db),
    notifier: createPrismaNotifier(db),
  };
}

/** Thrown inside the transaction only to roll a refused unit of work back. */
class Refused extends Error {
  override name = 'Refused';
}

/**
 * Runs each use case in one interactive transaction (read committed). Every
 * write, events included, commits together. A refusal or a thrown error rolls
 * all of it back; Prisma rolls back only on a throw, so a refusal is thrown
 * inside the transaction and returned outside it.
 */
export function createPrismaUnitOfWork(prisma: PrismaClient): UnitOfWork<PrismaTx> {
  return {
    run: async <T, E>(work: (tx: PrismaTx) => Promise<Result<T, E>>): Promise<Result<T, E>> => {
      const outcome: { refusal?: Result<T, E> } = {};
      try {
        return await prisma.$transaction(async (tx) => {
          const result = await work(createPrismaTx(tx));
          if (!result.isOk) {
            outcome.refusal = result;
            throw new Refused();
          }
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
