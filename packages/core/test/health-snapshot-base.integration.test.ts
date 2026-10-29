import { createIdGenerator, type FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { baseSeqStatement, baseTurnsStatement } from '../src/adapters/prisma/health-snapshots.js';
import { createPrismaSnapshotUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { hourMarkOf } from '../src/domain/shared/health-snapshot.js';
import { ok } from '../src/domain/shared/result.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

// The first snapshot on a fleet with a history: on the scale fleet the base
// hour's seq walked the fleet's events in seq order, and each lease's turn
// walked its events back to its last turn report, each for tens of seconds.
// Their plans read the events by time and the turn reports through their own
// partial index instead. The plan is asserted, not a time, which would flake
// under load. The history is numbered after the fleet's founding events, as
// a fleet seeded with its history is.

const SHIPS = 50;
const EVENTS = 200_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const newId = createIdGenerator();

let core: PostgresCore;
let fleetId: FleetId;
let hour: Date;

/** A month of events, one in four a turn report of one of the fleet's leases, seeded in bulk. */
async function seedHistory(start: Date): Promise<void> {
  const leaseIds = Array.from({ length: SHIPS }, () => newId('lease'));
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_seed' || i, ${fleetId}, 'ship-' || i, 'agent', ${start}, 'agent', '{}'
    FROM generate_series(1, ${SHIPS}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO leases (id, fleet_id, ship_id, started_at, location, last_seen_at, turn, turn_at)
    SELECT (${leaseIds}::text[])[i], ${fleetId}, 'shp_seed' || i, ${start}, 'DEVICE', ${start}, 'busy', ${start}
    FROM generate_series(1, ${SHIPS}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO events (id, fleet_id, type, occurred_at, actor_kind, details, ship_id, seq)
    SELECT 'evt_seed' || i, ${fleetId}, (ARRAY['ShipReported', 'DeliveryAcknowledged', 'LeaseSeen', 'TurnReported'])[1 + i % 4],
           ${start}::timestamptz + i * interval '10 seconds', 'system',
           CASE WHEN i % 4 = 3 THEN jsonb_build_object('leaseId', (${leaseIds}::text[])[1 + (i / 4) % ${SHIPS}::int], 'turn', 'busy') ELSE '{}' END,
           'shp_seed' || (1 + i % ${SHIPS}::int), 1000000 + i
    FROM generate_series(1, ${EVENTS}::int) i`;
  await core.prisma.$executeRaw`ANALYZE`;
}

beforeAll(async () => {
  core = await createPostgresCore();
  fleetId = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))).fleetId;
  await seedHistory(new Date(core.clock.now().getTime() - 30 * DAY_MS));
  hour = hourMarkOf(new Date(core.clock.now().getTime() - 10 * DAY_MS));
}, 120_000);

afterAll(async () => {
  await core.close();
});

async function planOf(statement: Prisma.Sql): Promise<string> {
  const rows = await core.prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${statement}`);
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

describe("the first snapshot's opening hour on a fleet with a history", () => {
  it('starts after the last event before the hour, though the fleet was founded after it', async () => {
    const [last] = await core.prisma.$queryRaw<{ seq: bigint }[]>`SELECT max(seq) AS seq FROM events WHERE fleet_id = ${fleetId} AND occurred_at <= ${hour} AND seq >= 1000000`;

    const base = unwrap(await createPrismaSnapshotUnitOfWork(core.prisma).run(async (tx) => ok(await tx.healthSnapshots.baseAt(fleetId, hour))));

    expect(base.seq).toBe(Number(last?.seq));
    expect(base.turns).toHaveLength(SHIPS);
  });

  it("finds its seq through the fleet's events by time, not every event in seq order", async () => {
    expect(await planOf(baseSeqStatement(fleetId, hour))).not.toContain('events_fleet_id_seq_key');
  });

  it("finds each lease's turn through the index of turn reports, not every event back to its last", async () => {
    expect(await planOf(baseTurnsStatement(fleetId, hour))).toContain('events_turn_reported_idx');
  });
});
