import { idSchema, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import type { Crew } from '../src/domain/shared/caller.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';

// The exchange read, the list of exchanges and seen up to here on a fleet of
// 3,000 ships and a long history, a quarter of it the person ship's with its
// 3,000 others (docs/design/exchange-read, section 1, outcome 5): each stays
// inside the read budget of the performance skill, p95 under 100 ms.

const SHIPS = 3_000;
const HISTORY = 200_000;
/** One message in this many is between thomas and another ship, each way in turn. */
const THOMAS_EVERY = 4;
/** The busiest other ship: one of thomas's messages in this many is with it. */
const BUSIEST_EVERY = 10;
const RUNS = 20;
const P95_BUDGET_MS = 100;
/** The 95th percentile of RUNS sorted times. */
const P95_INDEX = Math.ceil(RUNS * 0.95) - 1;

let prisma: PrismaClient;
let useCases: UseCases;
let fleetId: FleetId;
let thomas: Crew;
const busiest = idSchema('ship').parse(`shp_${'1'.padStart(26, '0')}`);

/**
 * The other ships, and their history: every fourth message is between thomas
 * and one of them, a tenth of those with the busiest, each way in turn, the
 * rest between two others; all acknowledged but thomas's last 50 from the
 * busiest. The rollup is filled from it as its migration fills it.
 */
async function seedHistory(start: Date): Promise<void> {
  const other = (i: string) => `'shp_' || lpad((1 + ${i} % ${SHIPS}::int)::text, 26, '0')`;
  await prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_' || lpad(i::text, 26, '0'), ${fleetId}, 'ship-' || i, 'agent', ${start}, 'agent', '{}'
    FROM generate_series(1, ${SHIPS}::int) i`;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE seeded AS
    SELECT i,
      CASE WHEN i % ${THOMAS_EVERY} = 0 THEN
        CASE WHEN (i / ${THOMAS_EVERY}) % ${BUSIEST_EVERY} = 0 THEN '${busiest}' ELSE ${other('i')} END
      ELSE ${other('i')} END AS a,
      CASE WHEN i % ${THOMAS_EVERY} = 0 THEN '${thomas.shipId}' ELSE ${other('(i + 7)')} END AS b
    FROM generate_series(1, ${String(HISTORY)}) i`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
    SELECT 'msg_' || lpad(i::text, 26, '0'), '${fleetId}', CASE WHEN i % 2 = 0 THEN a ELSE b END, 'ship', CASE WHEN i % 2 = 0 THEN b ELSE a END,
           'hello', 'text/plain', 'key' || i, 'hash', '${start.toISOString()}'::timestamptz + i * interval '1 second'
    FROM seeded`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO deliveries (id, fleet_id, message_id, sender_ship_id, recipient_ship_id, is_in_exchange, state, claimed_by_ship_id, created_at)
    SELECT 'dlv_' || lpad(i::text, 26, '0'), '${fleetId}', 'msg_' || lpad(i::text, 26, '0'), CASE WHEN i % 2 = 0 THEN a ELSE b END, CASE WHEN i % 2 = 0 THEN b ELSE a END, true,
           (CASE WHEN i > ${String(HISTORY - 50 * THOMAS_EVERY * BUSIEST_EVERY)} AND a = '${busiest}' AND i % 2 = 0 THEN 'pending' ELSE 'dismissed' END)::delivery_state,
           NULL, '${start.toISOString()}'::timestamptz + i * interval '1 second'
    FROM seeded`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO exchanges (fleet_id, ship_id, other_ship_id, newest_message_id, unacknowledged)
    SELECT x.fleet_id, x.ship_id, x.other_ship_id, max(x.message_id), (count(*) FILTER (WHERE x.is_to_ship AND x.state IN ('pending', 'received', 'handed')))::int
    FROM (
      SELECT d.fleet_id, d.reached_ship_id AS ship_id, d.sender_ship_id AS other_ship_id, d.message_id, d.state, true AS is_to_ship FROM deliveries d WHERE d.is_in_exchange
      UNION ALL
      SELECT d.fleet_id, d.sender_ship_id, d.reached_ship_id, d.message_id, d.state, false FROM deliveries d WHERE d.is_in_exchange
    ) x
    JOIN ships s ON s.fleet_id = x.fleet_id AND s.id = x.ship_id AND s.kind = 'person'
    GROUP BY 1, 2, 3`);
  await prisma.$executeRaw`DROP TABLE seeded`;
  await prisma.$executeRaw`ANALYZE`;
}

beforeAll(async () => {
  prisma = createPrismaClient(await createMigratedDatabase());
  useCases = createUseCases({ prisma, clock: systemClock });
  const fleet = unwrap(await withOperatorLogin(prisma, useCases.initialiseFleet({ name: 'home fleet' })));
  ({ fleetId } = fleet);
  const { shipId, secret } = unwrap(await useCases.commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  thomas = unwrap(await useCases.authenticate.byCrewToken(crewToken));
  await seedHistory(new Date(Date.now() - 2 * HISTORY * 1000));
}, 300_000);

afterAll(async () => {
  await prisma.$disconnect();
});

/** The 95th percentile of RUNS runs of the read, after one to warm up. */
async function p95Of(read: () => Promise<unknown>): Promise<number> {
  await read();
  const times: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const startedAt = performance.now();
    await read();
    times.push(performance.now() - startedAt);
  }
  return times.sort((first, second) => first - second)[P95_INDEX] ?? Number.POSITIVE_INFINITY;
}

describe(`the exchanges of a person ship on a fleet of ${String(SHIPS)} ships and ${String(HISTORY)} messages`, () => {
  it('reads the newest page of its busiest exchange, an older page and the page around a message inside the read budget', async () => {
    const newest = unwrap(await useCases.readExchange(thomas, { otherShipId: busiest }));
    const middle = idSchema('message').parse(`msg_${String(HISTORY / 2).padStart(26, '0')}`);

    expect(newest.items).toHaveLength(20);
    expect(await p95Of(async () => unwrap(await useCases.readExchange(thomas, { otherShipId: busiest })))).toBeLessThan(P95_BUDGET_MS);
    expect(await p95Of(async () => unwrap(await useCases.readExchange(thomas, { otherShipId: busiest, before: newest.olderCursor ?? undefined })))).toBeLessThan(P95_BUDGET_MS);
    expect(await p95Of(async () => unwrap(await useCases.readExchange(thomas, { otherShipId: busiest, around: middle })))).toBeLessThan(P95_BUDGET_MS);
  });

  it('lists its exchanges, a page at a time, inside the read budget', async () => {
    const first = unwrap(await useCases.readExchanges(thomas, {}));

    expect(first.items).toHaveLength(20);
    expect(first.items.find((item) => item.otherShipId === busiest)?.unacknowledged).toBe(50);
    expect(await p95Of(async () => unwrap(await useCases.readExchanges(thomas, {})))).toBeLessThan(P95_BUDGET_MS);
    expect(await p95Of(async () => unwrap(await useCases.readExchanges(thomas, { cursor: first.nextCursor ?? undefined })))).toBeLessThan(P95_BUDGET_MS);
  });

  it('marks its busiest exchange seen up to its newest message inside the budget', async () => {
    const [newest] = await prisma.$queryRaw<{ id: MessageId }[]>`
      SELECT message_id AS id FROM deliveries WHERE fleet_id = ${fleetId} AND reached_ship_id = ${thomas.shipId} AND sender_ship_id = ${busiest} ORDER BY id DESC LIMIT 1`;
    const upTo = idSchema('message').parse(newest?.id);
    const shipId: ShipId = busiest;

    const startedAt = performance.now();
    const seen = unwrap(await useCases.acknowledgeUpTo(thomas, { otherShipId: shipId, messageId: upTo }));
    const took = performance.now() - startedAt;

    expect(seen).toEqual({ acknowledged: 50 });
    expect(took).toBeLessThan(P95_BUDGET_MS * 5);
    expect(await p95Of(async () => unwrap(await useCases.acknowledgeUpTo(thomas, { otherShipId: shipId, messageId: upTo })))).toBeLessThan(P95_BUDGET_MS);
  });
});
