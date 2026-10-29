import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { shipCountsStatement } from '../src/adapters/prisma/ship-counts.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

// The ship counts on a fleet the size of the scale fleet: on staging the
// statement ran in 93 ms, but a subquery per ship awaiting crew, planned
// twice, put its estimated cost at 668,383, past Postgres's jit_above_cost
// (100,000) and its inlining and optimization thresholds (500,000), so each
// call spent 705 ms compiling it. The estimate is asserted, not a time.

/** Postgres's default jit_above_cost, staging's and production's. */
const JIT_ABOVE_COST = 100_000;
const SHIPS = 23_000;
/** Ships whose last lease ended: awaiting crew. */
const AWAITING = 2_700;
/** Ships with an open lease: crewed. */
const CREWED = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

let core: PostgresCore;
let fleetId: FleetId;

/** The ships, the first crewed, the next awaiting crew after a lease that ended, the rest retired. */
async function seedShips(start: Date): Promise<void> {
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes, retired_at)
    SELECT 'shp_' || lpad(i::text, 26, '0'), ${fleetId}, 'ship-' || i, 'agent', ${start}, 'agent', '{}',
           CASE WHEN i > ${CREWED + AWAITING}::int THEN ${start}::timestamptz + interval '1 day' END
    FROM generate_series(1, ${SHIPS}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO leases (id, fleet_id, ship_id, started_at, location, last_seen_at, ended_at)
    SELECT 'lse_' || lpad(i::text, 26, '0'), ${fleetId}, 'shp_' || lpad(i::text, 26, '0'), ${start}, 'CLOUD', ${start},
           CASE WHEN i > ${CREWED}::int THEN ${start}::timestamptz + interval '1 hour' END
    FROM generate_series(1, ${CREWED + AWAITING}::int) i`;
  await core.prisma.$executeRaw`ANALYZE`;
}

beforeAll(async () => {
  core = await createPostgresCore();
  fleetId = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))).fleetId;
  await seedShips(new Date(core.clock.now().getTime() - 30 * DAY_MS));
}, 120_000);

afterAll(async () => {
  await core.close();
});

describe('the ship counts on a fleet of 23,000 ships', () => {
  it("is estimated under Postgres's JIT threshold, so no call spends its time compiling the statement", async () => {
    const [plan] = await core.prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(
      Prisma.sql`EXPLAIN ${shipCountsStatement(fleetId, { reach: { kind: 'every' }, selected: Prisma.sql`` })}`,
    );
    const totalCost = Number(/cost=[\d.]+\.\.([\d.]+)/.exec(plan?.['QUERY PLAN'] ?? '')?.[1]);

    expect(totalCost).toBeLessThan(JIT_ABOVE_COST);
  });

  it('works out the status and crew request stage of the active ships only, and counts the retired ones as they are', async () => {
    const [row] = await core.prisma.$queryRaw<{ 'QUERY PLAN': unknown }[]>(
      Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON) ${shipCountsStatement(fleetId, { reach: { kind: 'every' }, selected: Prisma.sql`` })}`,
    );

    // argo and the crewed and awaiting ships; the 20,000 retired ones never go through the stages.
    expect(Math.max(...rowsOfNodes(row?.['QUERY PLAN'], 'CTE Scan'))).toBe(1 + CREWED + AWAITING);
  });
});

/** The rows each plan node of the type gave, over every such node. */
function rowsOfNodes(plan: unknown, nodeType: string): number[] {
  if (Array.isArray(plan)) {
    return plan.flatMap((each) => rowsOfNodes(each, nodeType));
  }
  if (typeof plan !== 'object' || plan === null) {
    return [];
  }
  const node = new Map(Object.entries(plan));
  const own = node.get('Node Type') === nodeType ? [Number(node.get('Actual Rows')) * Number(node.get('Actual Loops'))] : [];
  return [...own, ...[...node.values()].flatMap((each) => rowsOfNodes(each, nodeType))];
}
