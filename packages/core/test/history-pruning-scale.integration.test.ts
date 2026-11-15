/** Retention at the 10 million message target: plans must bound each batch's work by its candidates, not the fleet's history (#1302). */
import type { FleetId } from '@aeolus-fleet/common';
// This integration test observes the adapter's actual SQL and parameters for EXPLAIN.
// eslint-disable-next-line no-restricted-imports
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PrismaClient } from '../src/adapters/prisma/generated/client.js';
import { createPrismaHistoryPruner } from '../src/adapters/prisma/history-pruner.js';
import { createPrismaBulkUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createPrismaFleetRepository } from '../src/adapters/prisma/registry.js';
import { createPruneHistory } from '../src/domain/shared/prune-history.js';
import { createIdGenerator } from '@aeolus-fleet/common';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

const SHIPS = 3_000;
const DELIVERIES = 120_000;
const OPEN = 300;
const DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;
const RETENTION_DAYS = 89;
let core: PostgresCore;
let fleetId: FleetId;
let start: Date;
let prisma: PrismaClient;
const spacingMs = (DAYS * DAY_MS) / DELIVERIES;
const statements: { query: string; params: string }[] = [];

async function seedHistory(): Promise<void> {
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_' || lpad(i::text, 26, '0'), ${fleetId}, 'ship-' || i, 'agent', ${start}, 'agent', '{}'
    FROM generate_series(1, ${SHIPS}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
    SELECT 'msg_' || lpad(i::text, 26, '0'), ${fleetId}, 'shp_' || lpad((1 + i % ${SHIPS}::int)::text, 26, '0'), 'ship', 'shp_' || lpad((1 + (i + 1) % ${SHIPS}::int)::text, 26, '0'), 'hello', 'text/plain', 'key' || i, 'hash',
           ${start}::timestamptz + i * ${spacingMs}::float8 * interval '1 millisecond'
    FROM generate_series(1, ${DELIVERIES}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO deliveries (id, fleet_id, message_id, sender_ship_id, recipient_ship_id, state, created_at)
    SELECT 'dlv_' || lpad(i::text, 26, '0'), ${fleetId}, 'msg_' || lpad(i::text, 26, '0'), 'shp_' || lpad((1 + i % ${SHIPS}::int)::text, 26, '0'), 'shp_' || lpad((1 + (i + 1) % ${SHIPS}::int)::text, 26, '0'),
           (CASE WHEN i > ${DELIVERIES - OPEN}::int THEN 'pending' ELSE 'dismissed' END)::delivery_state,
           ${start}::timestamptz + i * ${spacingMs}::float8 * interval '1 millisecond'
    FROM generate_series(1, ${DELIVERIES}::int) i`;
  // Each delivery's MessageAccepted at its send, as core writes it, then its receipt and dismissal.
  await core.prisma.$executeRaw`
    INSERT INTO events (id, fleet_id, type, occurred_at, actor_kind, details, ship_id, message_id, delivery_id, seq)
    SELECT 'evt_' || lpad((3 * i + step)::text, 26, '0'), ${fleetId}, (ARRAY['MessageAccepted', 'DeliveryReceived', 'DeliveryDismissed'])[step + 1],
           ${start}::timestamptz + i * ${spacingMs}::float8 * interval '1 millisecond' + step * interval '1 minute', 'system', '{}',
           'shp_' || lpad((1 + (i + 1) % ${SHIPS}::int)::text, 26, '0'), 'msg_' || lpad(i::text, 26, '0'), 'dlv_' || lpad(i::text, 26, '0'), 1000000 + 3 * i + step
    FROM generate_series(1, ${DELIVERIES}::int) i, generate_series(0, 2) step
    WHERE step = 0 OR i <= ${DELIVERIES - OPEN}::int`;
  await core.prisma.$executeRaw`UPDATE fleets SET last_event_seq = (SELECT max(seq) FROM events WHERE fleet_id = ${fleetId}) WHERE id = ${fleetId}`;
  await core.prisma.$executeRaw`ANALYZE`;
}

beforeAll(async () => {
  core = await createPostgresCore();
  const now = core.clock.now();
  start = new Date(now.getTime() - DAYS * DAY_MS);
  core.clock.set(start.toISOString());
  fleetId = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))).fleetId;
  await seedHistory();
  core.clock.set(now.toISOString());
  const telling = new PrismaClient({ adapter: new PrismaPg({ connectionString: core.databaseUrl }), log: [{ emit: 'event', level: 'query' }] });
  telling.$on('query', (event) => { statements.push({ query: event.query, params: event.params }); });
  prisma = telling;
}, 300_000);

afterAll(async () => {
  await prisma.$disconnect();
  await core.close();
});

describe('retention on a fleet with a long history', () => {
  it('reads a batch through indexes without scanning the message or event history', async () => {
    // Given a fleet with 3,000 ships and enough history for Postgres to choose a scale plan.
    statements.length = 0;
    const cutoff = new Date(core.clock.now().getTime() - 30 * DAY_MS);

    // When retention reads one batch from the real adapter.
    const pruner = createPrismaHistoryPruner(prisma);
    const candidates = await pruner.candidates(fleetId, { cutoff, after: null, limit: BATCH });
    const last = candidates.at(-1);
    if (last === undefined) {
      throw new Error('The scale history must fill a pruning batch');
    }
    const next = await pruner.candidates(fleetId, { cutoff, after: { createdAt: last.createdAt, id: last.id }, limit: BATCH });
    const reads = [...statements];
    const plans: string[] = [];
    for (const read of reads) {
      const params = z.array(z.unknown()).parse(JSON.parse(read.params));
      const rows = await core.prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${read.query}`, ...params);
      plans.push(rows.map((row) => row['QUERY PLAN']).join('\n'));
    }

    // Then the batch stays bounded as history grows to 10 million messages.
    expect(candidates).toHaveLength(BATCH);
    expect(next).toHaveLength(BATCH);
    expect(candidates[0]?.id).toBe('msg_00000000000000000000000001');
    expect(next[0]?.id).toBe('msg_00000000000000000000000501');
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.join('\n')).not.toMatch(/Seq Scan on (messages|deliveries|events)/);
    expect(plans.join('\n')).not.toContain('hashed SubPlan');
  });

  it('keeps the large fleet for good when retention is unset', async () => {
    // Given the fleet has no retention configured.
    // When its pruning pass runs.
    await core.useCases.pruneHistory();

    // Then its messages and retention boundary remain untouched.
    expect(await core.prisma.message.count({ where: { fleetId } })).toBe(DELIVERIES);
    expect(await core.prisma.event.count({ where: { fleetId, type: 'HistoryPruned' } })).toBe(0);
    expect((await core.prisma.fleet.findUniqueOrThrow({ where: { id: fleetId } })).keptFrom).toBeNull();
  });

  it('prunes finished history in committed batches and writes HistoryPruned', async () => {
    // Given a fleet whose snapshot has fallen behind its long history, and retention of 89 days.
    await core.prisma.$executeRaw`UPDATE fleets SET retention_set = true, retention_days = ${RETENTION_DAYS} WHERE id = ${fleetId}`;
    const failures: unknown[] = [];
    const prune = createPruneHistory({ fleets: createPrismaFleetRepository(core.prisma), uow: createPrismaBulkUnitOfWork(core.prisma), clock: core.clock, ids: createIdGenerator(), budgetMs: 0 });

    // When a pass spends its budget after one batch, then the next hour continues.
    await core.useCases.closeHealthSnapshots((_, error) => failures.push(error));
    await prune((_, error) => failures.push(error));
    core.clock.advance(60 * 60 * 1000);
    await prune((_, error) => failures.push(error));

    // Then both batches committed, with an event each, leaving the unfinished pass's kept_from alone.
    expect(failures).toEqual([]);
    expect(await core.prisma.message.count({ where: { fleetId } })).toBe(DELIVERIES - 2 * BATCH);
    expect(await core.prisma.event.count({ where: { fleetId, type: 'HistoryPruned' } })).toBe(2);
    expect((await core.prisma.fleet.findUniqueOrThrow({ where: { id: fleetId } })).keptFrom).toBeNull();

    // The third hour finishes: one message every 64.8 seconds means 1,444
    // messages before the cutoff, now 26 hours after the history began.
    core.clock.advance(60 * 60 * 1000);
    await prune((_, error) => failures.push(error));
    expect(failures).toEqual([]);
    expect(await core.prisma.message.count({ where: { fleetId } })).toBe(DELIVERIES - 1_444);
    const pruned = await core.prisma.event.findMany({ where: { fleetId, type: 'HistoryPruned' }, orderBy: { seq: 'asc' }, select: { details: true } });
    expect(pruned.map((event) => event.details)).toEqual([
      expect.objectContaining({ messages: 500, deliveries: 500, events: 1_500 }),
      expect.objectContaining({ messages: 500, deliveries: 500, events: 1_500 }),
      expect.objectContaining({ messages: 444, deliveries: 444, events: 1_332 }),
    ]);
    expect((await core.prisma.fleet.findUniqueOrThrow({ where: { id: fleetId } })).keptFrom).toEqual(new Date(core.clock.now().getTime() - RETENTION_DAYS * DAY_MS));
  }, 120_000);
});
