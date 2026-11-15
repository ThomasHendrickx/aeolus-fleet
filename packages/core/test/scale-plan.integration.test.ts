/** Holding-scale H1: plans reject history scans on a real, analysed scale fleet. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { seedScaleFleet } from './support/scale-fleet.js';

let core: PostgresCore;
let fleet: Awaited<ReturnType<typeof seedScaleFleet>>;
beforeAll(async () => {
  core = await createPostgresCore();
  fleet = await seedScaleFleet(core);
}, 180_000);
afterAll(async () => { await core.close(); });

describe('holding-scale query plans', () => {
  it('accepts an indexed lookup on 3,000 ships and 120,000 messages', async () => {
    // Given the shared scale fleet.
    const counts = await core.prisma.$queryRaw<{ ships: bigint; messages: bigint }[]>`
      SELECT (SELECT count(*) FROM ships WHERE fleet_id = ${fleet.fleetId}) AS ships,
             (SELECT count(*) FROM messages WHERE fleet_id = ${fleet.fleetId}) AS messages`;
    expect(counts).toEqual([{ ships: 3_000n, messages: 120_000n }]);

    // When a read selects one message by its fleet and id.
    const plan = await assertIndexedPlan(core.prisma, Prisma.sql`
      SELECT payload FROM messages WHERE fleet_id = ${fleet.fleetId} AND id = 'msg_00000000000000000000000001'`);

    // Then the plan uses an index.
    expect(plan).toContain('Index');
  });

  it.each(['messages', 'deliveries', 'events'])('rejects a sequential scan of %s', async (table) => {
    // Given a read of the entire history, even beneath an aggregate.
    const statement = Prisma.sql`SELECT count(*) FROM ${Prisma.raw(table)} WHERE fleet_id = ${fleet.fleetId}`;

    // When indexes are unavailable, PostgreSQL must scan the history.
    // Then the shared assertion rejects the actual plan, including nested/parallel scans.
    await core.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_indexscan = off`;
      await tx.$executeRaw`SET LOCAL enable_indexonlyscan = off`;
      await tx.$executeRaw`SET LOCAL enable_bitmapscan = off`;
      await expect(assertIndexedPlan(tx, statement)).rejects.toThrow(/Seq Scan/);
    });
  });
});
