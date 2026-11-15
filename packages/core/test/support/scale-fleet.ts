/** Bulk scale history for plan tests. See scale-fleet.md for its data and extensions. */
import { Prisma } from '../../src/adapters/prisma/generated/client.js';
import { unwrap } from '../../src/testing/result.js';
import type { PostgresCore } from './postgres-core.js';

const SHIPS = 3_000;
const MESSAGES = 120_000;
const RECENT = 5_000;
const FIRST_SEQ = 1_000_000;

/** A fresh fleet with argo, 2,999 agents, messages, deliveries and their events; ANALYZE runs after seeding. */
export async function seedScaleFleet(core: PostgresCore, options: { messages?: number; rows?: Prisma.Sql } = {}) {
  const fleet = unwrap(await core.useCases.initialiseFleet({ name: 'scale fleet' }));
  const { fleetId, operatorShipId } = fleet;
  const messages = options.messages ?? MESSAGES;
  const rows = options.rows ?? Prisma.sql`
    SELECT i, 'shp_' || lpad((1 + i % ${SHIPS - 1}::int)::text, 26, '0') AS recipient,
      ${core.clock.now()}::timestamptz - CASE WHEN i <= ${messages - RECENT}::int THEN interval '90 days' ELSE interval '30 minutes' END AS sent_at,
      i > ${messages - RECENT}::int AS waiting
    FROM generate_series(1, ${messages}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_' || lpad(i::text, 26, '0'), ${fleetId}, 'agent-' || i, 'agent', ${core.clock.now()}::timestamptz - interval '90 days', 'agent', '{}'
    FROM generate_series(1, ${SHIPS - 1}::int) i`;
  await core.prisma.$executeRaw`
    WITH seeded AS (${rows})
    INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
    SELECT 'msg_' || lpad(x.i::text, 26, '0'), ${fleetId}, ${operatorShipId}, 'ship', x.recipient, 'hello', 'text/plain', 'seed-' || x.i, 'hash', x.sent_at
    FROM seeded x`;
  await core.prisma.$executeRaw`
    WITH seeded AS (${rows})
    INSERT INTO deliveries (id, fleet_id, message_id, sender_ship_id, recipient_ship_id, state, created_at)
    SELECT 'dlv_' || lpad(x.i::text, 26, '0'), ${fleetId}, 'msg_' || lpad(x.i::text, 26, '0'), ${operatorShipId}, x.recipient,
      (CASE WHEN x.waiting THEN 'pending' ELSE 'dismissed' END)::delivery_state, x.sent_at
    FROM seeded x`;
  await core.prisma.$executeRaw`
    WITH seeded AS (${rows})
    INSERT INTO events (id, fleet_id, type, occurred_at, actor_kind, details, delivery_id, seq)
    SELECT 'evt_' || lpad((2 * x.i + step)::text, 26, '0'), ${fleetId}, (ARRAY['MessageAccepted', 'DeliveryDismissed'])[step + 1],
      x.sent_at + step * interval '1 second', 'system', '{}', 'dlv_' || lpad(x.i::text, 26, '0'), ${FIRST_SEQ}::bigint + 2 * x.i + step
    FROM seeded x, generate_series(0, 1) step
    WHERE step = 0 OR NOT x.waiting`;
  const [last] = await core.prisma.$queryRaw<{ seq: bigint }[]>`SELECT max(seq) AS seq FROM events WHERE fleet_id = ${fleetId}`;
  const lastSeq = Number(last?.seq);
  await core.prisma.$executeRaw`UPDATE fleets SET last_event_seq = ${lastSeq} WHERE id = ${fleetId}`;
  await core.prisma.$executeRaw`ANALYZE`;
  return { ...fleet, firstSeq: FIRST_SEQ, lastSeq };
}
