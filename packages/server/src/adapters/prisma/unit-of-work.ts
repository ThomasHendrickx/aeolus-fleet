import type {
  CallerLookup,
  ConsoleSessionRepository,
  CredentialRepository,
} from '../../core/identity/ports.js';
import type {
  FleetRepository,
  InFlightDeliveries,
  LeaseRepository,
  ShipRepository,
} from '../../core/registry/ports.js';
import type { EventLog } from '../../core/shared/events.js';
import type { UnitOfWork } from '../../core/shared/unit-of-work.js';
import type { Db, PrismaClient } from './client.js';
import { createPrismaEventLog } from './event-log.js';
import {
  createPrismaCallerLookup,
  createPrismaConsoleSessionRepository,
  createPrismaCredentialRepository,
} from './identity.js';
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
  consoleSessions: ConsoleSessionRepository;
  events: EventLog;
}

export function createPrismaTx(db: Db): PrismaTx {
  return {
    fleets: createPrismaFleetRepository(db),
    ships: createPrismaShipRepository(db),
    leases: createPrismaLeaseRepository(db),
    inFlightDeliveries: createPrismaInFlightDeliveries(db),
    credentials: createPrismaCredentialRepository(db),
    consoleSessions: createPrismaConsoleSessionRepository(db),
    events: createPrismaEventLog(db),
  };
}

/**
 * Runs each use case in one interactive transaction (read committed). Every
 * write, events included, commits together; a thrown error rolls all of it back.
 */
export function createPrismaUnitOfWork(prisma: PrismaClient): UnitOfWork<PrismaTx> {
  return {
    run: (work) => prisma.$transaction((tx) => work(createPrismaTx(tx))),
  };
}

/** Caller lookups run outside a unit of work: each is one statement. */
export function createPrismaCallers(prisma: PrismaClient): CallerLookup {
  return createPrismaCallerLookup(prisma);
}
