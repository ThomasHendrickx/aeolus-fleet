import { createIdGenerator } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import type { Fleet } from '../src/core/registry/fleet.js';
import { refuse } from '../src/core/shared/errors.js';
import { ok } from '../src/core/shared/result.js';
import { createMigratedDatabase } from './support/database.js';

// The unit of work on a real Postgres: a use case's writes commit together
// when it succeeds, and none of them stay when it refuses or fails.

const newId = createIdGenerator();

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await createMigratedDatabase());
});

afterAll(async () => {
  await prisma.$disconnect();
});

function aFleet(): Fleet {
  return { id: newId('fleet'), name: 'home fleet', createdAt: new Date('2026-09-29T12:00:00.000Z') };
}

describe('the Prisma unit of work', () => {
  it('commits what the work wrote when it returns an ok result', async () => {
    const fleet = aFleet();

    const result = await createPrismaUnitOfWork(prisma).run(async (tx) => {
      await tx.fleets.create(fleet);
      return ok(fleet.id);
    });

    expect(result).toEqual(ok(fleet.id));
    await expect(prisma.fleet.findUnique({ where: { id: fleet.id } })).resolves.toEqual(fleet);
  });

  it('rolls back what the work wrote when it refuses, and returns the refusal', async () => {
    const fleet = aFleet();

    const result = await createPrismaUnitOfWork(prisma).run(async (tx) => {
      await tx.fleets.create(fleet);
      return refuse('FLEET_ALREADY_EXISTS', 'refused after a write');
    });

    expect(result).toEqual({ isOk: false, error: { kind: 'FLEET_ALREADY_EXISTS', message: 'refused after a write' } });
    await expect(prisma.fleet.findUnique({ where: { id: fleet.id } })).resolves.toBeNull();
  });

  it('rolls back what the work wrote when it throws, and passes the error on', async () => {
    const fleet = aFleet();

    const run = createPrismaUnitOfWork(prisma).run(async (tx) => {
      await tx.fleets.create(fleet);
      throw new Error('disk full');
    });

    await expect(run).rejects.toThrow('disk full');
    await expect(prisma.fleet.findUnique({ where: { id: fleet.id } })).resolves.toBeNull();
  });
});
