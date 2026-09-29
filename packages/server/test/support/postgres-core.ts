import { createPrismaClient, type PrismaClient } from '../../src/adapters/prisma/client.js';
import type { Clock } from '../../src/core/shared/clock.js';
import { createUseCases, type UseCases } from '../../src/wiring.js';
import { FLEET_URL } from './core-fixtures.js';
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
    useCases: createUseCases({ prisma, clock, fleetUrl: FLEET_URL }),
    close: () => prisma.$disconnect(),
  };
}
