import { idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { crewedShipsStatement } from '../src/adapters/prisma/registry.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases, systemClock } from '../src/wiring.js';
import { withOperatorLogin } from './support/operator-login.js';

// Which of a page's senders hold an open lease (#1714) is read along the
// leases' index for the referenced senders alone, never a scan of every
// lease, so it costs the same in a fleet of 3,000 ships with a long crew
// history as in a small one. The plan is asserted, not a time, which would
// flake under load.

const SHIPS = 3_000;
/** Ended leases per ship: every ship was crewed and released many times. */
const ENDED_LEASES = 20;
const PAGE = 20;

let prisma: PrismaClient;
let fleetId: FleetId;

const shipIdOf = (index: number): ShipId => idSchema('ship').parse(`shp_${String(index).padStart(26, '0')}`);

beforeAll(async () => {
  prisma = createPrismaClient(await createMigratedDatabase());
  const useCases = createUseCases({ prisma, clock: systemClock });
  ({ fleetId } = unwrap(await withOperatorLogin(prisma, useCases.initialiseFleet({ name: 'home fleet' }))));
  const start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  await prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_' || lpad(i::text, 26, '0'), ${fleetId}, 'ship-' || i, 'agent', ${start}, 'agent', '{}'
    FROM generate_series(1, ${SHIPS}::int) i`;
  // Every ship crewed and released ENDED_LEASES times; every other one crewed now.
  await prisma.$executeRaw`
    INSERT INTO leases (id, fleet_id, ship_id, location, harness, crew_token_hash, started_at, ended_at)
    SELECT 'lse_' || lpad((i * 100 + n)::text, 26, '0'), ${fleetId}, 'shp_' || lpad(i::text, 26, '0'), 'DEVICE'::location_kind, 'claude-code',
           'hash-' || i || '-' || n, ${start}::timestamptz + n * interval '1 day',
           CASE WHEN n = 0 AND i % 2 = 0 THEN NULL ELSE ${start}::timestamptz + n * interval '1 day' + interval '1 hour' END
    FROM generate_series(1, ${SHIPS}::int) i, generate_series(0, ${ENDED_LEASES}::int) n`;
  await prisma.$executeRaw`ANALYZE`;
}, 300_000);

afterAll(async () => {
  await prisma.$disconnect();
});

async function planOf(statement: Prisma.Sql): Promise<string> {
  const rows = await prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${statement}`);
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

describe("a page's senders in a fleet of 3,000 ships with a long crew history", () => {
  it('finds which of them a session crews along the leases index, not every lease', async () => {
    const senders = Array.from({ length: PAGE }, (_, index) => shipIdOf(index * 150 + 1));

    const plan = await planOf(crewedShipsStatement({ fleetId, shipIds: senders }));

    expect(plan).toMatch(/Index (Only )?Scan using leases_/);
    expect(plan).not.toMatch(/Seq Scan on leases/);
  });

  it('answers the crewed ones among them', async () => {
    const senders = [shipIdOf(1), shipIdOf(2), shipIdOf(3), shipIdOf(4)];

    const rows = await prisma.$queryRaw<{ ship_id: string }[]>(crewedShipsStatement({ fleetId, shipIds: senders }));

    expect(rows.map((row) => row.ship_id).sort()).toEqual([shipIdOf(2), shipIdOf(4)]);
  });
});
