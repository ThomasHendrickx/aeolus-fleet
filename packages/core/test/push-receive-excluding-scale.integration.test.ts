import { idSchema, PUSH_RECEIVE_EXCLUDING_MAX, type DeliveryId, type FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import type { Crew } from '../src/domain/shared/caller.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';

// A push receive that excludes as many delivery ids as it may, from a crew
// that holds them all, on a fleet with 3,000 ships and a long history: it
// stays inside the read budget of the performance skill (p95 under 100 ms).

const SHIPS = 3_000;
const HISTORY = 200_000;
/** Pending after the held ones: enough for every run to take 10 new. */
const PENDING = 250;
const RUNS = 20;
const P95_BUDGET_MS = 100;
/** The 95th percentile of RUNS sorted times. */
const P95_INDEX = Math.ceil(RUNS * 0.95) - 1;

let prisma: PrismaClient;
let useCases: UseCases;
let fleetId: FleetId;
let scout: Crew;
let held: DeliveryId[];

/** The fleet's other ships and their history, every delivery dismissed. */
async function seedHistory(start: Date): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_' || lpad(i::text, 26, '0'), ${fleetId}, 'ship-' || i, 'agent', ${start}, 'agent', '{}'
    FROM generate_series(1, ${SHIPS}::int) i`;
  await prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
    SELECT 'msg_' || lpad(i::text, 26, '0'), ${fleetId}, 'shp_' || lpad((1 + i % ${SHIPS}::int)::text, 26, '0'), 'ship', 'shp_' || lpad((1 + (i + 1) % ${SHIPS}::int)::text, 26, '0'), 'hello', 'text/plain', 'key' || i, 'hash',
           ${start}::timestamptz + i * interval '1 second'
    FROM generate_series(1, ${HISTORY}::int) i`;
  await prisma.$executeRaw`
    INSERT INTO deliveries (id, fleet_id, message_id, recipient_ship_id, state, created_at)
    SELECT 'dlv_' || lpad(i::text, 26, '0'), ${fleetId}, 'msg_' || lpad(i::text, 26, '0'), 'shp_' || lpad((1 + (i + 1) % ${SHIPS}::int)::text, 26, '0'), 'dismissed', ${start}::timestamptz + i * interval '1 second'
    FROM generate_series(1, ${HISTORY}::int) i`;
}

/** The scout's deliveries: as many held received under its lease as a push receive may exclude, and some pending after them. */
async function seedScoutInbox(start: Date): Promise<void> {
  const first = HISTORY + 1;
  const last = HISTORY + PUSH_RECEIVE_EXCLUDING_MAX + PENDING;
  await prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
    SELECT 'msg_' || lpad(i::text, 26, '0'), ${fleetId}, 'shp_' || lpad('1', 26, '0'), 'ship', ${scout.shipId}, 'hello', 'text/plain', 'key' || i, 'hash',
           ${start}::timestamptz + i * interval '1 second'
    FROM generate_series(${first}::int, ${last}::int) i`;
  await prisma.$executeRaw`
    INSERT INTO deliveries (id, fleet_id, message_id, recipient_ship_id, state, claimed_by_ship_id, claimed_by_lease_id, created_at)
    SELECT 'dlv_' || lpad(i::text, 26, '0'), ${fleetId}, 'msg_' || lpad(i::text, 26, '0'), ${scout.shipId},
           (CASE WHEN i < ${first + PUSH_RECEIVE_EXCLUDING_MAX}::int THEN 'received' ELSE 'pending' END)::delivery_state,
           CASE WHEN i < ${first + PUSH_RECEIVE_EXCLUDING_MAX}::int THEN ${scout.shipId} END,
           CASE WHEN i < ${first + PUSH_RECEIVE_EXCLUDING_MAX}::int THEN ${scout.leaseId} END,
           ${start}::timestamptz + i * interval '1 second'
    FROM generate_series(${first}::int, ${last}::int) i`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM deliveries WHERE fleet_id = ${fleetId} AND claimed_by_lease_id = ${scout.leaseId}`;
  held = rows.map((row) => idSchema('delivery').parse(row.id));
  await prisma.$executeRaw`ANALYZE`;
}

beforeAll(async () => {
  prisma = createPrismaClient(await createMigratedDatabase());
  useCases = createUseCases({ prisma, clock: systemClock });
  const fleet = unwrap(await withOperatorLogin(prisma, useCases.initialiseFleet({ name: 'home fleet' })));
  ({ fleetId } = fleet);
  const { shipId, secret } = unwrap(await useCases.commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  scout = unwrap(await useCases.authenticate.byCrewToken(crewToken));
  const start = new Date(Date.now() - 2 * HISTORY * 1000);
  await seedHistory(start);
  await seedScoutInbox(start);
}, 300_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe(`a push receive excluding ${String(PUSH_RECEIVE_EXCLUDING_MAX)} held deliveries on a fleet of ${String(SHIPS)} ships`, () => {
  it('answers inside the read budget, p95 under 100 ms, with none it excluded', async () => {
    // The first push receive of a lease also marks it pushed, once: not a read the budget is about.
    unwrap(await useCases.pushReceiveDeliveries(scout, { max: 10, excluding: held }));
    const times: number[] = [];
    const answered: DeliveryId[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const startedAt = performance.now();
      const { deliveries } = unwrap(await useCases.pushReceiveDeliveries(scout, { max: 10, excluding: held }));
      times.push(performance.now() - startedAt);
      answered.push(...deliveries.map((delivery) => delivery.deliveryId));
    }

    expect(answered.filter((deliveryId) => held.includes(deliveryId))).toEqual([]);
    expect(times.sort((first, second) => first - second)[P95_INDEX]).toBeLessThan(P95_BUDGET_MS);
  });
});
