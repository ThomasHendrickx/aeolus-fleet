import { PAGE_SIZE_MAX, PING_CONTENT_TYPE, type FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { fleetListingStatement } from '../src/adapters/prisma/registry.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';

// The fleet snapshot on a fleet with a history (#1027): at 113 ships the
// listing walked every event of the fleet once per ship to find who crewed
// it, and every delivery to a ship to find its last ping, taking seconds and
// holding a pooled connection all that time. Its plan reads both through
// their own partial indexes instead. The plan is asserted, not a time, which
// would flake under load.

const SHIPS = 112;
const MESSAGES = 20_000;
const EVENTS = 200_000;
/** One message in this many is a ping. */
const PING_EVERY = 10;

let core: PostgresCore;
let fleetId: FleetId;

/** A fleet of 113 ships with a month of messages, pings and events, seeded in bulk. */
async function seedHistory(): Promise<void> {
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_seed' || i, ${fleetId}, 'ship-' || i, 'agent', now() - interval '30 days', 'agent', '{}'
    FROM generate_series(1, ${SHIPS}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO leases (id, fleet_id, ship_id, started_at, location, last_seen_at)
    SELECT 'lse_seed' || i, ${fleetId}, 'shp_seed' || i, now() - interval '1 day', 'DEVICE', now()
    FROM generate_series(1, ${SHIPS}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, payload, content_type, idempotency_key, created_at, request_hash, selector_kind, selector_ship_id, sender_ship_id, model)
    SELECT 'msg_seed' || i, ${fleetId}, 'x', CASE WHEN i % ${PING_EVERY}::int = 0 THEN ${PING_CONTENT_TYPE} ELSE 'text/plain' END, 'seed-' || i,
           now() - interval '30 days' + i * interval '2 minutes', 'h', 'ship', 'shp_seed' || (1 + i % ${SHIPS}::int),
           'shp_seed' || (1 + (i * 7) % ${SHIPS}::int), CASE WHEN i % ${PING_EVERY}::int = 0 THEN NULL ELSE 'claude-opus-5-5' END
    FROM generate_series(1, ${MESSAGES}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO deliveries (id, fleet_id, message_id, recipient_ship_id, state, created_at)
    SELECT 'dlv_' || substr(id, 5), fleet_id, id, selector_ship_id, 'pending', created_at
    FROM messages WHERE fleet_id = ${fleetId} AND id LIKE 'msg_seed%'`;
  await core.prisma.$executeRaw`
    INSERT INTO events (id, fleet_id, type, occurred_at, actor_kind, details, ship_id, seq)
    SELECT 'evt_seed' || i, ${fleetId}, (ARRAY['ShipReported', 'DeliveryAcknowledged', 'LeaseSeen'])[1 + i % 3],
           now() - interval '30 days' + i * interval '10 seconds', 'system', '{}', 'shp_seed' || (1 + i % ${SHIPS}::int), 1000000 + i
    FROM generate_series(1, ${EVENTS}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO events (id, fleet_id, type, occurred_at, actor_kind, details, ship_id, seq)
    SELECT 'evt_seed_prompt' || i, ${fleetId}, 'StartingPromptIssued', now() - interval '2 days', 'system', '{}', 'shp_seed' || i, 2000000 + i
    FROM generate_series(1, ${SHIPS}::int) i`;
  await core.prisma.$executeRaw`ANALYZE`;
}

beforeAll(async () => {
  core = await createPostgresCore();
  fleetId = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))).fleetId;
  await seedHistory();
}, 120_000);

afterAll(async () => {
  await core.close();
});

async function listingPlan(): Promise<string> {
  const rows = await core.prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${fleetListingStatement(fleetId, { limit: PAGE_SIZE_MAX + 1, filter: {}, reach: { kind: 'every' } })}`);
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

describe('the fleet snapshot on a fleet with a history (#1027)', () => {
  it("finds who crewed each ship through the index of starting prompts issued, not the fleet's every event", async () => {
    expect(await listingPlan()).toContain('events_starting_prompt_issued_idx');
  });

  it('finds the last ping to each ship through the index of pings, not every delivery to it', async () => {
    expect(await listingPlan()).toContain('messages_pings_idx');
  });
});
