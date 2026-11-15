/** Health reads and snapshot closes look up only the newly sent deliveries, not a fleet's message history (#1301). */
import { PrismaPg } from '@prisma/adapter-pg';
import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PrismaClient } from '../src/adapters/prisma/generated/client.js';
import { createPrismaHealthSnapshots } from '../src/adapters/prisma/health-snapshots.js';
import { unwrap } from '../src/testing/result.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

const EVENTS = 120_000;
const SENT = 5_000;
let core: PostgresCore;
let fleetId: FleetId;

beforeAll(async () => {
  core = await createPostgresCore();
  ({ fleetId } = unwrap(await core.useCases.initialiseFleet({ name: 'busy fleet' })));
  await core.prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
    SELECT 'msg_' || lpad(i::text, 26, '0'), s.fleet_id, s.id, 'ship', s.id, 'hello', 'text/plain', 'seed-' || i, 'hash', ${core.clock.now()}
    FROM ships s, generate_series(1, ${EVENTS}::int) i
    WHERE s.fleet_id = ${fleetId} AND s.name = 'argo'`;
  await core.prisma.$executeRaw`
    INSERT INTO deliveries (id, fleet_id, message_id, sender_ship_id, recipient_ship_id, state, created_at)
    SELECT 'dlv_' || lpad(i::text, 26, '0'), s.fleet_id, 'msg_' || lpad(i::text, 26, '0'), s.id, s.id, 'pending', ${core.clock.now()}
    FROM ships s, generate_series(1, ${EVENTS}::int) i
    WHERE s.fleet_id = ${fleetId} AND s.name = 'argo'`;
  await core.prisma.$executeRaw`
    INSERT INTO events (id, fleet_id, type, occurred_at, actor_kind, details, delivery_id, seq)
    SELECT 'evt_' || lpad(i::text, 26, '0'), ${fleetId}, 'MessageAccepted',
      ${core.clock.now()}::timestamptz - interval '1 hour', 'system', '{}', 'dlv_' || lpad(i::text, 26, '0'), 1000000 + i
    FROM generate_series(1, ${EVENTS}::int) i`;
  await core.prisma.$executeRaw`ANALYZE`;
}, 120_000);

afterAll(async () => {
  await core.close();
});

describe('health event replay on a busy fleet', () => {
  it.each([undefined, SENT])('looks up only newly sent deliveries and messages with event limit %s', async (limit) => {
    // Given 120,000 stored messages and a snapshot with 5,000 new sends after it.
    const statements: { query: string; params: string }[] = [];
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: core.databaseUrl }),
      log: [{ emit: 'event', level: 'query' }],
    });
    client.$on('query', ({ query, params }) => {
      statements.push({ query, params });
    });
    try {
      // When a health read (unlimited) or the snapshot closer (one page) replays those sends.
      const after = await createPrismaHealthSnapshots(client).eventsAfter(fleetId, { seq: 1000000 + EVENTS - SENT, ...(limit === undefined ? {} : { limit }) });

      // Then all new sends retain their delivery facts, without scanning the stored history.
      expect(after.events).toHaveLength(SENT);
      expect(after.events[0]?.seq).toBe(1000000 + EVENTS - SENT + 1);
      expect(after.events.at(-1)?.seq).toBe(1000000 + EVENTS);
      expect(after.sent).toHaveLength(SENT);
      expect(new Set(after.sent.map((delivery) => delivery.deliveryId)).size).toBe(SENT);
      const reads = statements.filter(({ query }) => query.includes('d.message_id') && query.includes('m.sender_ship_id'));
      expect(reads.length).toBeGreaterThan(0);
      for (const { query, params } of reads) {
        const values = z.array(z.union([z.string(), z.number(), z.null(), z.array(z.string())])).parse(JSON.parse(params));
        // The statement and parameters come only from this client's query log.
        const plan = (await core.prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>('EXPLAIN ' + query, ...values))
          .map((row) => row['QUERY PLAN']).join('\n');
        expect(plan.match(/Seq Scan on (deliveries|messages)/g)).toBeNull();
      }
    } finally {
      await client.$disconnect();
    }
  });
});
