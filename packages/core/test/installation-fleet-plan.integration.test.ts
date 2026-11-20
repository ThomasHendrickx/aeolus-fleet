import { idSchema, type FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClientTellingStatements } from '../src/adapters/prisma/client.js';
import { createPrismaShipRepository } from '../src/adapters/prisma/registry.js';
import { createPrismaFleetLimitReads } from '../src/adapters/prisma/installation.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';
import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { installationFleetsStatement } from '../src/adapters/prisma/installation.js';
import { messageWindow } from '../src/domain/registry/installation-fleet.js';
import { OPERATOR } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';

// An installation fleet on a fleet with a long history (#1126): its messages
// in the last 7 days are counted through the messages' index on fleet and
// time, not by reading every message the fleet stored. The plan is asserted,
// not a time, which would flake under load.

const MESSAGES = 20_000;
/** The seeded messages spread over this many days, so the last 7 hold a small share. */
const HISTORY_DAYS = 200;

let core: PostgresCore;
let fleetId: FleetId;

beforeAll(async () => {
  core = await createPostgresCore();
  ({ fleetId } = unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  await core.prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
    SELECT 'msg_seed' || i, s.fleet_id, s.id, 'ship', s.id, 'x', 'text/plain', 'seed-' || i, 'h',
           ${core.clock.now()}::timestamptz - (i * ${HISTORY_DAYS}::int / ${MESSAGES}::int) * interval '1 day'
    FROM ships s, generate_series(1, ${MESSAGES}::int) i
    WHERE s.fleet_id = ${fleetId} AND s.name = 'argo'`;
  await core.prisma.$executeRaw`ANALYZE messages`;
}, 120_000);

afterAll(async () => {
  await core.close();
});

describe('an installation fleet on a fleet with a long history (#1126)', () => {
  it('counts its messages in the last 7 days through the index on fleet and time, not every message it stored', async () => {
    const rows = await core.prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${installationFleetsStatement(fleetId, messageWindow(core.clock.now()))}`);
    const plan = rows.map((row) => row['QUERY PLAN']).join('\n');

    await assertIndexedPlan(core.prisma, installationFleetsStatement(fleetId, messageWindow(core.clock.now())));
    expect(plan).toContain('messages_fleet_id_created_at_idx');
    expect(plan).not.toContain('Seq Scan on messages');
  });
});

 it('reads quota usage and enforcement counts through the fleet ship index', async () => {
   // Given the fleet and a client recording the actual count statements.
   const statements: { query: string; params: string }[] = [];
   const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => statements.push({ query, params }));
   try {
     // When quota usage and enforcement read their active count.
     await createPrismaShipRepository(client).countActive(fleetId);
     await createPrismaFleetLimitReads(client).activeShips(fleetId);

     // Then both counts stay fleet-scoped and use its ship index.
     expect(statements).toHaveLength(2);
     for (const statement of statements) {
       const plan = await assertIndexedPlan(core.prisma, statement);
       expect(plan).toContain('Index');
       expect(plan).toContain('fleet_id');
     }
   } finally {
     await client.$disconnect();
   }
 });

 it('walks owner ancestors and finds direct children through fleet-scoped ship indexes', async () => {
   // Given a fleet and a client capturing the ownership reads.
   const argo = await core.prisma.ship.findFirstOrThrow({ where: { fleetId, kind: 'operator' } });
   const statements: { query: string; params: string }[] = [];
   const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => statements.push({ query, params }));
   try {
     // When validation looks up an ancestor and retirement looks up its children.
     const ships = createPrismaShipRepository(client);
     await ships.find(fleetId, idSchema('ship').parse(argo.id));
     await ships.listActiveOwnedByForUpdate(fleetId, idSchema('ship').parse(argo.id));

     // Then the queries use the scoped indexes without scanning history.
     expect(statements).toHaveLength(2);
     for (const statement of statements) {
       const plan = await assertIndexedPlan(core.prisma, statement);
       expect(plan).toContain('Index');
       expect(plan).toContain('fleet_id');
     }
   } finally {
     await client.$disconnect();
   }
 });
