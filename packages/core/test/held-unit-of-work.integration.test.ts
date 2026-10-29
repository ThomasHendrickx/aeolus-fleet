import { createIdGenerator } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { ok } from '../src/domain/shared/result.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { heldUnitOfWork } from './support/postgres-core.js';

// The held unit of work the race tests build on: its transaction keeps the
// locks it took until another transaction waits for them, however late that
// one comes, so the race a test names is the race that runs (#630).

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

describe('a held unit of work', () => {
  it('holds its locks until another transaction waits for them, however late that one comes', async () => {
    const fleetId = newId('fleet');
    await prisma.fleet.create({ data: { id: fleetId, name: 'home fleet', createdAt: new Date('2026-09-29T12:00:00.000Z') } });
    const steps: string[] = [];
    const { uow, reached } = heldUnitOfWork(prisma, (tx, hold) => ({
      ...tx,
      fleets: {
        ...tx.fleets,
        findForUpdate: async (id) => {
          const fleet = await tx.fleets.findForUpdate(id);
          await hold();
          steps.push('the held one goes on');
          return fleet;
        },
      },
    }));
    const held = uow.run(async (tx) => ok(await tx.fleets.findForUpdate(fleetId)));
    await reached;
    await new Promise((resolve) => setTimeout(resolve, LATE_MS));

    steps.push('the late one comes');
    const late = createPrismaUnitOfWork(prisma).run(async (tx) => {
      await tx.fleets.findForUpdate(fleetId);
      steps.push('the late one locks');
      return ok(undefined);
    });
    await Promise.all([held, late]);

    expect(steps).toEqual(['the late one comes', 'the held one goes on', 'the late one locks']);
  });
});
