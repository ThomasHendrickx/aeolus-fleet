import { createIdGenerator } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { ok } from '../src/domain/shared/result.js';
import { createMigratedDatabase } from './support/database.js';
import { racingUnitOfWork } from './support/postgres-core.js';

// The racing unit of work the race tests build on: its transactions go on
// from the held step only once all of them have met there, however late one
// comes, so the race a test names is the race that runs (#644).

const newId = createIdGenerator();
/** How late the other transaction comes: later than a loaded machine's slowest start in these tests. */
const LATE_MS = 1_000;

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await createMigratedDatabase());
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('a racing unit of work', () => {
  it('holds every transaction at its step until all of them get there, however late one comes', async () => {
    const steps: string[] = [];
    const uow = racingUnitOfWork({ prisma, transactions: 2 }, (tx, allArrived) => ({
      ...tx,
      fleets: {
        ...tx.fleets,
        findForUpdate: async (id) => {
          await allArrived();
          steps.push('one goes on');
          return tx.fleets.findForUpdate(id);
        },
      },
    }));
    const race = () => uow.run(async (tx) => ok(await tx.fleets.findForUpdate(newId('fleet'))));

    const early = race();
    await new Promise((resolve) => setTimeout(resolve, LATE_MS));
    steps.push('the late one comes');
    await Promise.all([early, race()]);

    expect(steps).toEqual(['the late one comes', 'one goes on', 'one goes on']);
  });
});
