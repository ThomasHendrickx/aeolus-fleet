import { createPrismaClient, type PrismaClient } from '../../src/adapters/prisma/client.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../../src/adapters/prisma/unit-of-work.js';
import type { Clock } from '../../src/domain/shared/clock.js';
import type { UnitOfWork } from '../../src/domain/shared/unit-of-work.js';
import { createUseCases, type UseCases } from '../../src/wiring.js';
import { createMigratedDatabase } from './database.js';

export interface TestClock extends Clock {
  set(iso: string): void;
  advance(ms: number): void;
}

export function createTestClock(startAt = '2026-09-29T12:00:00.000Z'): TestClock {
  let now = new Date(startAt);
  return {
    now: () => new Date(now),
    set: (iso) => {
      now = new Date(iso);
    },
    advance: (ms) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

export interface PostgresCore {
  databaseUrl: string;
  prisma: PrismaClient;
  clock: TestClock;
  useCases: UseCases;
  close(): Promise<void>;
}

/** A fresh migrated database with every use case wired to it through Prisma, on a test clock. */
export async function createPostgresCore(): Promise<PostgresCore> {
  const databaseUrl = await createMigratedDatabase();
  const prisma = createPrismaClient(databaseUrl);
  const clock = createTestClock();
  return {
    databaseUrl,
    prisma,
    clock,
    useCases: createUseCases({ prisma, clock }),
    close: () => prisma.$disconnect(),
  };
}

/** How long a racing transaction waits for the others before it goes on alone. */
export const RACE_WAIT_MS = 250;

/**
 * The Prisma unit of work, with every transaction held at one step until all
 * of them get there (or a moment passes). Without that the transactions finish
 * one after the other and never race; a lock taken before that step keeps them
 * apart anyway. `holdAt` returns the ports with the step wrapped.
 */
export function racingUnitOfWork(
  race: { prisma: PrismaClient; transactions: number },
  holdAt: (tx: PrismaTx, allArrived: () => Promise<void>) => PrismaTx,
): UnitOfWork<PrismaTx> {
  const uow = createPrismaUnitOfWork(race.prisma);
  let arrived: (() => void)[] = [];
  const allArrived = () =>
    new Promise<void>((resolve) => {
      arrived.push(resolve);
      if (arrived.length === race.transactions) {
        arrived.forEach((release) => {
          release();
        });
        arrived = [];
      }
      setTimeout(resolve, RACE_WAIT_MS);
    });
  return { run: (work) => uow.run((tx) => work(holdAt(tx, allArrived))) };
}

/** How often a held transaction looks whether another one waits for its locks. */
const WAITER_POLL_MS = 10;

/** Settles once a transaction on this database waits for a lock: there, the one a held transaction holds. */
async function aTransactionWaits(prisma: PrismaClient): Promise<void> {
  for (;;) {
    const [found] = await prisma.$queryRaw<{ isWaiting: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'
      ) AS "isWaiting"`;
    if (found?.isWaiting === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, WAITER_POLL_MS));
  }
}

/**
 * The Prisma unit of work, with its transaction held at one step: `reached`
 * settles when the transaction gets there, holding every lock it took before,
 * and the transaction goes on once another transaction waits for one of those
 * locks, however late that one comes (#630). For a race whose other side
 * never waits for it, `hold(until)` goes on once `until` settles instead.
 * `holdAt` returns the ports with the step wrapped.
 */
export function heldUnitOfWork(
  prisma: PrismaClient,
  holdAt: (tx: PrismaTx, hold: (until?: Promise<void>) => Promise<void>) => PrismaTx,
): { uow: UnitOfWork<PrismaTx>; reached: Promise<void> } {
  const uow = createPrismaUnitOfWork(prisma);
  const reached = Promise.withResolvers<undefined>();
  const hold = async (until?: Promise<void>) => {
    reached.resolve(undefined);
    await (until ?? aTransactionWaits(prisma));
  };
  return { uow: { run: (work) => uow.run((tx) => work(holdAt(tx, hold))) }, reached: reached.promise };
}

const TABLES = ['fleets', 'ships', 'leases', 'credentials', 'messages', 'deliveries', 'events', 'console_sessions'];

/** Every row of every table as JSON text, to search for what must never be stored. */
export async function everyRow(prisma: PrismaClient): Promise<string> {
  const tables = await Promise.all(
    // The table names are the constant list above, never outside input.
    TABLES.map((table) => prisma.$queryRawUnsafe<unknown[]>(`SELECT row_to_json(t) AS row FROM ${table} t`)),
  );
  return JSON.stringify(tables);
}
