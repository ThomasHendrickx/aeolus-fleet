import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { baseCandidatesStatement, baseDeliveriesStatement, createPrismaHealthRecords, replayDeliveriesStatement } from '../src/adapters/prisma/health.js';
import { createPrismaSnapshotUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { hourMarkOf } from '../src/domain/shared/health-snapshot.js';
import { ok } from '../src/domain/shared/result.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

// The deliveries the stuck rule replays, on a fleet with a long history: on
// the scale fleet (#1161) the replay's "open, or with an event since" was one
// OR, so Postgres scanned every delivery and message of the fleet, and the
// first snapshot's base read every step of its deliveries through one IN
// list; neither finished in 120 s. Each now reads its two parts through their
// own indexes and each delivery's steps through the events by delivery. The
// plan is asserted, not a time, which would flake under load.

const SHIPS = 20;
const DELIVERIES = 120_000;
/** The newest deliveries, never received: open now. */
const OPEN = 300;
const DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

let core: PostgresCore;
let fleetId: FleetId;
let start: Date;
const spacingMs = (DAYS * DAY_MS) / DELIVERIES;

/** One message and delivery every `spacingMs` over the days, each received a minute after its send and dismissed a minute later, but the newest. */
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
    INSERT INTO deliveries (id, fleet_id, message_id, recipient_ship_id, state, created_at)
    SELECT 'dlv_' || lpad(i::text, 26, '0'), ${fleetId}, 'msg_' || lpad(i::text, 26, '0'), 'shp_' || lpad((1 + (i + 1) % ${SHIPS}::int)::text, 26, '0'),
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
  await core.prisma.$executeRaw`ANALYZE`;
}

/** The deliveries sent in [from, to), by the seed's spacing. */
function sentBetween(from: Date, to: Date): number {
  const first = Math.ceil((from.getTime() - start.getTime()) / spacingMs);
  const last = Math.ceil((to.getTime() - start.getTime()) / spacingMs) - 1;
  return last - first + 1;
}

beforeAll(async () => {
  core = await createPostgresCore();
  fleetId = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))).fleetId;
  start = new Date(core.clock.now().getTime() - DAYS * DAY_MS);
  await seedHistory();
}, 300_000);

afterAll(async () => {
  await core.close();
});

async function planOf(statement: Prisma.Sql): Promise<string> {
  const rows = await core.prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${statement}`);
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

describe("the replay's deliveries on a fleet with a long history", () => {
  it('reads the open deliveries and those with an event since through their indexes, never every delivery or message', async () => {
    const plan = await planOf(replayDeliveriesStatement(fleetId, new Date(core.clock.now().getTime() - 7 * DAY_MS)));

    expect(plan).not.toMatch(/Seq Scan on (deliveries|messages|events)/);
  });

  it('answers the open deliveries and those with an event since, each with its steps', async () => {
    const since = new Date(core.clock.now().getTime() - DAY_MS);

    const { deliveries } = await createPrismaHealthRecords(core.prisma).read(fleetId, since);

    // An event at most two minutes after its send, and the open ones the newest.
    expect(deliveries).toHaveLength(sentBetween(new Date(since.getTime() - 2 * MINUTE_MS), new Date(core.clock.now().getTime() + 1)));
    expect(deliveries.filter((delivery) => delivery.steps.length === 0)).toHaveLength(OPEN);
  });
});

describe("the first snapshot's base on a fleet with a long history", () => {
  it('reads the deliveries open at the hour through their indexes, never every delivery or message', async () => {
    const plan = await planOf(baseDeliveriesStatement(fleetId, hourMarkOf(new Date(core.clock.now().getTime() - 167 * HOUR_MS))));

    expect(plan).not.toMatch(/Seq Scan on (deliveries|messages|events)/);
  });

  it('looks up only the deliveries sent by the hour, dropping those sent after it in the scan of the events after it', async () => {
    const hour = hourMarkOf(new Date(core.clock.now().getTime() - 167 * HOUR_MS));

    const candidates = await core.prisma.$queryRaw<{ id: string }[]>(baseCandidatesStatement(fleetId, hour));

    // Sent by the hour with an event after it: dismissed after the hour.
    expect(candidates).toHaveLength(sentBetween(new Date(hour.getTime() - 2 * MINUTE_MS + 1), new Date(hour.getTime() + 1)));
  });

  it('keeps the deliveries open at the hour, each at its latest step by then', async () => {
    const hour = hourMarkOf(new Date(core.clock.now().getTime() - 167 * HOUR_MS));

    const base = unwrap(await createPrismaSnapshotUnitOfWork(core.prisma).run(async (tx) => ok(await tx.healthSnapshots.baseAt(fleetId, hour))));

    // Sent in the two minutes before the hour: not yet dismissed by then.
    expect(base.deliveries).toHaveLength(sentBetween(new Date(hour.getTime() - 2 * MINUTE_MS + 1), new Date(hour.getTime() + 1)));
  });
});
