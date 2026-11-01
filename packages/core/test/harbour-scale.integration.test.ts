import { idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { harbourCountsStatement, harbourPageStatement } from '../src/adapters/prisma/harbour.js';
import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

// Harbour's read at the target size (docs/design/fleet-overview, "The read
// Harbour needs"; performance design, decision 4): 3,000 active ships and
// as many retired, half of the active ones crewed with a report, 300 with
// an open alert. A page of 500 reads only its ships through the keyset
// index, and each one's lease and alerts once; the numbers read only the
// active ships; neither is costly enough for Postgres to compile it (JIT).
// The plan is asserted, not a time, which would flake under load; staging
// measures the time (decision 7).

const SHIPS = 3_000;
const CREWED_EVERY = 2;
const ALERT_EVERY = 10;
const PAGE = 500;
/** Postgres's default jit_above_cost, staging's and production's. */
const JIT_ABOVE_COST = 100_000;

let core: PostgresCore;
let fleetId: FleetId;

function seeded(i: number): { id: ShipId; name: string } {
  return { id: idSchema('ship').parse(`shp_0${String(i).padStart(25, '0')}`), name: `ship-${String(i)}` };
}

beforeAll(async () => {
  core = await createPostgresCore();
  fleetId = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))).fleetId;
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_0' || lpad(i::text, 25, '0'), ${fleetId}, 'ship-' || i, 'agent', now(), 'agent', '{}'
    FROM generate_series(1, ${SHIPS}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes, retired_at)
    SELECT 'shp_1' || lpad(i::text, 25, '0'), ${fleetId}, 'ship-' || i, 'agent', now(), 'agent', '{}', now()
    FROM generate_series(1, ${SHIPS}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO leases (id, fleet_id, ship_id, started_at, location, last_seen_at, report_state, report_note, reported_at, report_changed_at)
    SELECT 'lse_0' || lpad(i::text, 25, '0'), ${fleetId}, 'shp_0' || lpad(i::text, 25, '0'), now(), 'CLOUD', now(),
           (ARRAY['working', 'blocked', 'idle'])[1 + i % 3]::report_state, 'on task ' || i, now(), now()
    FROM generate_series(1, ${SHIPS}::int) i WHERE i % ${CREWED_EVERY}::int = 0`;
  await core.prisma.$executeRaw`
    INSERT INTO alerts (id, fleet_id, ship_id, signal, occurrence_key, facts, since, raised_at)
    SELECT 'alt_0' || lpad(i::text, 25, '0'), ${fleetId}, 'shp_0' || lpad(i::text, 25, '0'), 'delivery-unacknowledged', 'occurrence-' || i, '{}', now(), now()
    FROM generate_series(1, ${SHIPS}::int) i WHERE i % ${ALERT_EVERY}::int = 0`;
  await core.prisma.$executeRaw`ANALYZE`;
}, 120_000);

afterAll(async () => {
  await core.close();
});

async function planOf(statement: Prisma.Sql): Promise<unknown> {
  const [row] = await core.prisma.$queryRaw<{ 'QUERY PLAN': unknown }[]>(Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`);
  return row?.['QUERY PLAN'];
}

async function costOf(statement: Prisma.Sql): Promise<number> {
  const [row] = await core.prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${statement}`);
  return Number(/cost=[\d.]+\.\.([\d.]+)/.exec(row?.['QUERY PLAN'] ?? '')?.[1]);
}

/** Each plan node, flattened. */
function nodesOf(plan: unknown): Map<string, unknown>[] {
  if (Array.isArray(plan)) {
    return plan.flatMap(nodesOf);
  }
  if (typeof plan !== 'object' || plan === null) {
    return [];
  }
  const node = new Map(Object.entries(plan));
  return [node, ...[...node.values()].flatMap(nodesOf)];
}

/** The rows the plan read through the index named, before any filter dropped one, over every node that reads it. */
function rowsOfIndex(plan: unknown, index: string): number {
  return nodesOf(plan)
    .filter((node) => node.get('Index Name') === index)
    .reduce((sum, node) => sum + (Number(node.get('Actual Rows')) + Number(node.get('Rows Removed by Filter') ?? 0)) * Number(node.get('Actual Loops')), 0);
}

/** How many times the plan read the index named. */
function loopsOfIndex(plan: unknown, index: string): number {
  return nodesOf(plan)
    .filter((node) => node.get('Index Name') === index)
    .reduce((sum, node) => sum + Number(node.get('Actual Loops')), 0);
}

/** The ship rows the plan read, through any index or a scan, before any filter dropped one. */
function shipRowsRead(plan: unknown): number {
  return nodesOf(plan)
    .filter((node) => node.get('Relation Name') === 'ships')
    .reduce((sum, node) => sum + (Number(node.get('Actual Rows')) + Number(node.get('Rows Removed by Filter') ?? 0)) * Number(node.get('Actual Loops')), 0);
}

describe("Harbour's read at 3,000 ships", () => {
  it('reads a page of 500 through the keyset index however far on it starts, and each ship of the page its lease and alerts once', async () => {
    const { id, name } = seeded(2_400);
    const plan = await planOf(harbourPageStatement(fleetId, { reach: { kind: 'every' }, after: { isEmpty: true, value: '', name, id }, limit: PAGE + 1 }));

    expect([
      rowsOfIndex(plan, 'ships_listing_idx'),
      loopsOfIndex(plan, 'leases_ship_id_open_key') <= PAGE + 1,
      loopsOfIndex(plan, 'alerts_open_on_ship_idx') <= PAGE + 1,
    ]).toEqual([expect.toBeOneOf([PAGE + 1, PAGE + 2]), true, true]);
  });

  it('counts reading only the active ships, never the retired ones', async () => {
    const plan = await planOf(harbourCountsStatement(fleetId, { kind: 'every' }));

    // The 3,000 seeded active ships and argo.
    expect(shipRowsRead(plan)).toBeLessThanOrEqual(SHIPS + 1);
  });

  it("is estimated under Postgres's JIT threshold, page and numbers alike", async () => {
    const page = await costOf(harbourPageStatement(fleetId, { reach: { kind: 'every' }, limit: PAGE + 1 }));
    const counts = await costOf(harbourCountsStatement(fleetId, { kind: 'every' }));

    expect([page < JIT_ABOVE_COST, counts < JIT_ABOVE_COST]).toEqual([true, true]);
  });
});
