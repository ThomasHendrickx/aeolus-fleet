/** The snapshot close catches up a stale checkpoint on a fleet at staging's scale, looking up only the sent deliveries by key (#1301). */
import { STUCK_TREND_HOURS, type FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { createPrismaClientTellingStatements } from '../src/adapters/prisma/client.js';
import { createPrismaHealthSnapshots } from '../src/adapters/prisma/health-snapshots.js';
import { ensureHealthBootstrapIndex } from '../src/adapters/prisma/health-bootstrap-index.js';
import { baseDeliveriesStatement } from '../src/adapters/prisma/health.js';
import { createPrismaFleetRepository } from '../src/adapters/prisma/registry.js';
import { createPrismaSnapshotUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createCloseHealthSnapshots } from '../src/domain/shared/close-health-snapshots.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { operatorCaller } from '../src/testing/fleet.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';
import { seedScaleFleet } from './support/scale-fleet.js';

const SHIPS = 3_000;
/** Messages finished long before the checkpoint: the fleet's history. */
const HISTORY = 150_000;
/** The hours the close catches up after its first one, each with its sends. */
const CATCH_UP_HOURS = STUCK_TREND_HOURS - 1;
const SENDS_PER_HOUR = 1_000;
const SENDS = CATCH_UP_HOURS * SENDS_PER_HOUR;
/** One send in this many is never dismissed and still waits at the end. */
const WAITING_EVERY = 100;
const WAITING = SENDS / WAITING_EVERY;
const FIRST_SEQ = 1_000_000;
/** The last send still waits, so its MessageAccepted is the last event. */
const LAST_SEQ = FIRST_SEQ + 2 * (HISTORY + SENDS);
const HOUR_MS = 60 * 60 * 1000;
let core: PostgresCore;
let fleetId: FleetId;
let argo: ShipCaller;

beforeAll(async () => {
  core = await createPostgresCore();
  const firstHour = new Date(core.clock.now().getTime() - CATCH_UP_HOURS * HOUR_MS);
  // Message i: history up to HISTORY, 90 days old; after it, send j of catch-up hour k, j * 3 seconds into the hour.
  const rows = Prisma.sql`
    SELECT i, 'shp_' || lpad((1 + i % ${SHIPS - 1}::int)::text, 26, '0') AS recipient,
      CASE WHEN i <= ${HISTORY}::int THEN ${core.clock.now()}::timestamptz - interval '90 days'
        ELSE ${firstHour}::timestamptz + ((i - ${HISTORY}::int - 1) / ${SENDS_PER_HOUR}::int) * interval '1 hour'
          + (1 + (i - ${HISTORY}::int - 1) % ${SENDS_PER_HOUR}::int) * interval '3 seconds' END AS sent_at,
      i > ${HISTORY}::int AND (i - ${HISTORY}::int) % ${WAITING_EVERY}::int = 0 AS waiting
    FROM generate_series(1, ${HISTORY + SENDS}::int) i`;
  argo = operatorCaller(await seedScaleFleet(core, { messages: HISTORY + SENDS, rows }));
  ({ fleetId } = argo);
}, 600_000);

afterAll(async () => {
  await core.close();
});

describe('the snapshot close on a fleet at staging scale', () => {
  it('bootstraps the oldest catch-up hour without scanning message, delivery or event history', async () => {
    // Given 3,000 ships, 150,000 finished historical messages and 167 hourly batches of 1,000 sends.
    const firstHour = new Date(core.clock.now().getTime() - CATCH_UP_HOURS * HOUR_MS);
    await ensureHealthBootstrapIndex(core.databaseUrl);

    // When the first snapshot reads the deliveries open at the oldest catch-up hour.
    const statement = baseDeliveriesStatement(fleetId, firstHour);

    // Then every history read uses an index, including events nested beneath the candidate aggregate.
    expect(await assertIndexedPlan(core.prisma, statement)).toContain('events_delivery_bootstrap_idx');
  });

  it('serves and bootstraps while its time-range index waits, then finishes the index after start', async () => {
    // Given a table lock that makes a concurrent index build wait, but permits reads and writes.
    await core.prisma.$executeRaw`DROP INDEX CONCURRENTLY IF EXISTS events_delivery_bootstrap_idx`;
    const reached = Promise.withResolvers<undefined>();
    const released = Promise.withResolvers<undefined>();
    const blocker = core.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE events IN SHARE UPDATE EXCLUSIVE MODE`;
      reached.resolve(undefined);
      await released.promise;
    }, { timeout: 60_000 });
    void blocker.catch(reached.reject);
    const server = createApp({ databaseUrl: core.databaseUrl, publicUrl: 'http://localhost', clock: core.clock, logger: false, overduePassMs: 600_000 });
    await reached.promise;
    try {
      // When core starts listening before its index is ready.
      await server.listen({ host: '127.0.0.1', port: 0 });
      await expect.poll(async () => {
        const [row] = await core.prisma.$queryRaw<{ isWaiting: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
            AND query LIKE '%CREATE INDEX CONCURRENTLY IF NOT EXISTS events_delivery_bootstrap_idx%'
            AND wait_event_type = 'Lock') AS "isWaiting"`;
        return row?.isWaiting;
      }).toBe(true);

      // Then it serves and reconstructs the empty oldest hour correctly while the build waits.
      expect((await server.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      const firstHour = new Date(core.clock.now().getTime() - CATCH_UP_HOURS * HOUR_MS);
      expect((await createPrismaHealthSnapshots(core.prisma).baseAt(fleetId, firstHour)).deliveries).toEqual([]);
      released.resolve(undefined);
      await blocker;
      await expect.poll(async () => {
        const [row] = await core.prisma.$queryRaw<{ isReady: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('events_delivery_bootstrap_idx') AND indisvalid) AS "isReady"`;
        return row?.isReady;
      }, { timeout: 30_000 }).toBe(true);
      await assertIndexedPlan(core.prisma, baseDeliveriesStatement(fleetId, firstHour));
    } finally {
      released.resolve(undefined);
      await blocker;
      await server.close();
    }
  }, 60_000);

  it('catches up a stale checkpoint hour by hour, each hour looking up its sends by key', async () => {
    // Given 3,000 ships, 150,000 finished messages and a checkpoint 168 hours old, with 1,000 sends in each hour since.
    const snapshots = createPrismaHealthSnapshots(core.prisma);
    await core.prisma.healthSnapshot.deleteMany({ where: { fleetId } });
    await snapshots.write(fleetId, {
      hours: [{ hour: new Date(core.clock.now().getTime() - STUCK_TREND_HOURS * HOUR_MS), stuck: [], acknowledged: [] }],
      fold: { seq: FIRST_SEQ, deliveries: [], turns: [] },
    });
    const statements: { query: string; params: string }[] = [];
    const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => {
      statements.push({ query, params });
    });
    try {
      // When the scheduled close starts again at the oldest of the 168 hours and closes each hour after it.
      const errors: unknown[] = [];
      await createCloseHealthSnapshots({ fleets: createPrismaFleetRepository(client), uow: createPrismaSnapshotUnitOfWork(client), clock: core.clock })(
        (_fleetId, error) => {
          errors.push(error);
        },
      );

      // Then every hour closes inside its transaction and the checkpoint is current, counting the deliveries that still wait.
      expect(errors).toEqual([]);
      const latest = await snapshots.latest(fleetId);
      expect(latest?.hour).toEqual(core.clock.now());
      expect(latest?.fold.seq).toBe(LAST_SEQ);
      expect(latest?.fold.deliveries).toHaveLength(WAITING);
      expect((await core.useCases.readHealth(argo)).stuckPerHour.at(-1)?.count).toBe(WAITING);

      // And no lookup of the sent deliveries scans the fleet's deliveries or messages.
      const reads = statements.filter(({ query }) => query.includes('SELECT DISTINCT unnest(') && query.includes('m.sender_ship_id'));
      expect(reads.length).toBeGreaterThanOrEqual(CATCH_UP_HOURS);
      for (const { query, params } of reads) {
        await assertIndexedPlan(core.prisma, { query, params });
      }
    } finally {
      await client.$disconnect();
    }
  }, 600_000);
});
