import { idSchema, type FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { exchangeListStatement } from '../src/adapters/prisma/exchange-rollups.js';
import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { exchangePageStatement, unacknowledgedUpToStatement } from '../src/adapters/prisma/messaging.js';
import { prunedUpToStatement } from '../src/adapters/prisma/pruned-exchanges.js';
import type { Crew } from '../src/domain/shared/caller.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases, systemClock } from '../src/wiring.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';

// The exchange reads and the lookup of seen up to here are read through the
// indexes of the exchange and of what is open, never a scan of every
// delivery, so they cost the same on a fleet of 10,000,000 messages as on
// this one. The plan is asserted, not a time, which would flake under load.

const SHIPS = 300;
const PERSON_SHIPS = 500;
const HISTORY = 60_000;
/** The deliveries of its type thomas's crew claimed from the busiest ship, all but the last few done. */
const CLAIMED = 5_000;
/** One message in this many is between thomas and the busiest ship, each way in turn. */
const BUSIEST_EVERY = 4;
const PAGE = 20;

let prisma: PrismaClient;
let fleetId: FleetId;
let thomas: Crew;
const busiest = idSchema('ship').parse(`shp_${'1'.padStart(26, '0')}`);
const middle = idSchema('delivery').parse(`dlv_${String(HISTORY / 2).padStart(26, '0')}`);
const last = idSchema('delivery').parse(`dlv_${String(HISTORY).padStart(26, '0')}`);

beforeAll(async () => {
  prisma = createPrismaClient(await createMigratedDatabase());
  const useCases = createUseCases({ prisma, clock: systemClock });
  const fleet = unwrap(await withOperatorLogin(prisma, useCases.initialiseFleet({ name: 'home fleet' })));
  ({ fleetId } = fleet);
  const { shipId, secret } = unwrap(await useCases.commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  thomas = unwrap(await useCases.authenticate.byCrewToken(crewToken));
  const start = new Date(Date.now() - 2 * HISTORY * 1000);
  await prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_' || lpad(i::text, 26, '0'), ${fleetId}, 'ship-' || i, 'agent', ${start}, 'agent', '{}'
    FROM generate_series(1, ${SHIPS}::int) i`;
  // Every BUSIEST_EVERY-th message is between thomas and the busiest ship, each way in turn, the rest between two others;
  // the busiest ship's last 50 to thomas are still open.
  await prisma.$executeRaw`
    CREATE TABLE seeded AS
    SELECT i,
      CASE WHEN i % ${BUSIEST_EVERY}::int = 0 THEN ${busiest} ELSE 'shp_' || lpad((1 + i % ${SHIPS}::int)::text, 26, '0') END AS a,
      CASE WHEN i % ${BUSIEST_EVERY}::int = 0 THEN ${thomas.shipId} ELSE 'shp_' || lpad((1 + (i + 7) % ${SHIPS}::int)::text, 26, '0') END AS b
    FROM generate_series(1, ${HISTORY}::int) i`;
  await prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
    SELECT 'msg_' || lpad(i::text, 26, '0'), ${fleetId}, CASE WHEN i % 8 = 0 THEN b ELSE a END, 'ship', CASE WHEN i % 8 = 0 THEN a ELSE b END,
           'hello', 'text/plain', 'key' || i, 'hash', ${start}::timestamptz + i * interval '1 second'
    FROM seeded`;
  await prisma.$executeRaw`
    INSERT INTO deliveries (id, fleet_id, message_id, sender_ship_id, recipient_ship_id, is_in_exchange, state, created_at)
    SELECT 'dlv_' || lpad(i::text, 26, '0'), ${fleetId}, 'msg_' || lpad(i::text, 26, '0'), CASE WHEN i % 8 = 0 THEN b ELSE a END, CASE WHEN i % 8 = 0 THEN a ELSE b END, true,
           (CASE WHEN i > ${HISTORY - 50 * 8}::int AND i % 8 = 4 THEN 'pending' ELSE 'dismissed' END)::delivery_state,
           ${start}::timestamptz + i * interval '1 second'
    FROM seeded`;
  // Thomas's crew claimed CLAIMED deliveries of its type from the busiest ship, all but the last 5 done.
  await prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_type, payload, content_type, idempotency_key, request_hash, created_at)
    SELECT 'msg_t' || lpad(i::text, 25, '0'), ${fleetId}, ${busiest}, 'type', 'person', 'hello', 'text/plain', 'type-key' || i, 'hash', ${start}::timestamptz + i * interval '1 second'
    FROM generate_series(1, ${CLAIMED}::int) i`;
  await prisma.$executeRaw`
    INSERT INTO deliveries (id, fleet_id, message_id, sender_ship_id, recipient_type, claimed_by_ship_id, claimed_by_lease_id, is_in_exchange, state, created_at)
    SELECT 'dlv_t' || lpad(i::text, 25, '0'), ${fleetId}, 'msg_t' || lpad(i::text, 25, '0'), ${busiest}, 'person', ${thomas.shipId},
           (SELECT id FROM leases WHERE ship_id = ${thomas.shipId} LIMIT 1), true,
           (CASE WHEN i > ${CLAIMED}::int - 5 THEN 'received' ELSE 'dismissed' END)::delivery_state, ${start}::timestamptz + i * interval '1 second'
    FROM generate_series(1, ${CLAIMED}::int) i`;
  // The rollup: thomas exchanged with every other ship, and every other person ship with ten others, so it holds many ships' rows.
  await prisma.$executeRaw`
    INSERT INTO exchanges (fleet_id, ship_id, other_ship_id, newest_message_id, unacknowledged)
    SELECT ${fleetId}, ${thomas.shipId}, 'shp_' || lpad(i::text, 26, '0'), 'msg_' || lpad(i::text, 26, '0'), 0
    FROM generate_series(1, ${SHIPS}::int) i`;
  await prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_p' || lpad(i::text, 25, '0'), ${fleetId}, 'person-' || i, 'person', ${start}, 'person', '{}'
    FROM generate_series(1, ${PERSON_SHIPS}::int) i`;
  await prisma.$executeRaw`
    INSERT INTO exchanges (fleet_id, ship_id, other_ship_id, newest_message_id, unacknowledged)
    SELECT ${fleetId}, 'shp_p' || lpad(p::text, 25, '0'), 'shp_' || lpad(((p + o) % ${SHIPS}::int + 1)::text, 26, '0'), 'msg_' || lpad(((p * 31 + o * 7) % ${HISTORY}::int + 1)::text, 26, '0'), 0
    FROM generate_series(1, ${PERSON_SHIPS}::int) p, generate_series(1, 10) o`;
  // How far pruning went: thomas's exchange with every other ship, and every person ship's with ten others, marked.
  await prisma.$executeRaw`
    INSERT INTO pruned_exchanges (fleet_id, ship_id, other_ship_id, pruned_up_to)
    SELECT ${fleetId}, least(${thomas.shipId}, 'shp_' || lpad(i::text, 26, '0')), greatest(${thomas.shipId}, 'shp_' || lpad(i::text, 26, '0')), ${start}
    FROM generate_series(1, ${SHIPS}::int) i`;
  await prisma.$executeRaw`
    INSERT INTO pruned_exchanges (fleet_id, ship_id, other_ship_id, pruned_up_to)
    SELECT DISTINCT ${fleetId}, least(p.id, o.id), greatest(p.id, o.id), ${start}::timestamptz
    FROM generate_series(1, ${PERSON_SHIPS}::int) n
    CROSS JOIN LATERAL (SELECT 'shp_p' || lpad(n::text, 25, '0') AS id) p
    CROSS JOIN LATERAL (SELECT 'shp_' || lpad(((n + k) % ${SHIPS}::int + 1)::text, 26, '0') AS id FROM generate_series(1, 10) k) o`;
  await prisma.$executeRaw`DROP TABLE seeded`;
  await prisma.$executeRaw`ANALYZE`;
}, 300_000);

afterAll(async () => {
  await prisma.$disconnect();
});

async function planOf(statement: Prisma.Sql): Promise<string> {
  const rows = await prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${statement}`);
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

describe('the exchange reads on a fleet with a long history', () => {
  it.each([
    ['the newest page', { toward: 'older' as const }],
    ['an older page by cursor', { toward: 'older' as const, from: middle }],
    ['the older half of the page around a message', { toward: 'older' as const, from: middle, isFromIncluded: true }],
    ['the newer half of the page around a message', { toward: 'newer' as const, from: middle }],
  ])('reads %s along the exchange index of each direction, not every delivery', async (_name, position) => {
    const plan = await planOf(exchangePageStatement({ fleetId, shipId: thomas.shipId, otherShipId: busiest, limit: PAGE, ...position }));

    expect(plan).toContain('deliveries_exchange_idx');
    expect(plan).not.toMatch(/Seq Scan on deliveries/);
  });

  it('reads how far pruning went in the exchange by its primary key, whichever ship reads, not every mark (docs/design/exchange-history)', async () => {
    const byThomas = await planOf(prunedUpToStatement(fleetId, { shipId: thomas.shipId, otherShipId: busiest }));
    const byBusiest = await planOf(prunedUpToStatement(fleetId, { shipId: busiest, otherShipId: thomas.shipId }));

    for (const plan of [byThomas, byBusiest]) {
      expect(plan).toContain('pruned_exchanges_pkey');
      expect(plan).not.toMatch(/Seq Scan on pruned_exchanges/);
    }
  });

  it("lists a person ship's exchanges along the rollup's index of newest messages, not every exchange", async () => {
    const plan = await planOf(exchangeListStatement({ fleetId, shipId: thomas.shipId, limit: PAGE }));

    expect(plan).toContain('exchanges_fleet_id_ship_id_newest_message_id_idx');
    expect(plan).not.toMatch(/Seq Scan on (deliveries|exchanges)/);
  });

  it("finds the deliveries seen up to here along the indexes of what is open, not the ship's whole history", async () => {
    const plan = await planOf(unacknowledgedUpToStatement({ fleetId, shipId: thomas.shipId, otherShipId: busiest, upTo: last }));

    expect(plan).toContain('deliveries_fleet_id_recipient_ship_id_state_idx');
    expect(plan).toContain('deliveries_in_flight_claimed_idx');
    expect(plan).not.toMatch(/Seq Scan on deliveries/);
    expect(plan).not.toContain('deliveries_record_fleet_id_claimed_by_ship_id_id_idx');
  });
});
