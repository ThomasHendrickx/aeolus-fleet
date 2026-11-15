import { idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';

import type { ShipCaller } from '../../src/domain/shared/caller.js';
import { operatorCaller } from '../../src/testing/fleet.js';
import { unwrap } from '../../src/testing/result.js';
import type { PostgresCore } from './postgres-core.js';

/** The scale of the plan tests (holding scale, decision 2): what 10 M messages would plan like. */
export const SCALE_SHIPS = 3_000;
export const SCALE_MESSAGES = 120_000;
/** The newest messages, sent in the last half hour and never received: open now. */
export const SCALE_OPEN = 5_000;
/** Of the open ones, one in this many is received under its recipient's lease; of the old ones, one in this many is undeliverable. */
export const RECEIVED_EVERY = 5;
export const UNDELIVERABLE_EVERY = 1_000;
/** The seeded events start here, after the few events fleet init writes. */
const FIRST_SEQ = 1_000_000;

export interface ScaleHistory {
  fleetId: FleetId;
  argo: ShipCaller;
  /** Seeded ship i, from 1 to SCALE_SHIPS - 1. */
  shipId(i: number): ShipId;
  /** Seeded message and delivery i, from 1 to SCALE_MESSAGES. */
  messageId(i: number): string;
  deliveryId(i: number): string;
  /** The seq of the fleet's last seeded event. */
  lastSeq: bigint;
}

function padded(prefix: string, i: number): string {
  return prefix + String(i).padStart(26, '0');
}

/**
 * One fleet with a long history: 3,000 ships, each crewed under an open lease
 * after an ended one; 120,000 messages over 90 days, each sent by ship i to
 * ship i + 7 with one delivery, received a minute after its send and dismissed
 * (one in 1,000 undeliverable) a minute later, but the newest 5,000, sent in
 * the last half hour and still pending (one in 5 received under the lease);
 * each step with its event as core writes it.
 * Analysed, so its plans are those the fleet would use at the target.
 */
export async function seedScaleHistory(core: PostgresCore): Promise<ScaleHistory> {
  const argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'scale fleet' })));
  const { fleetId } = argo;
  const others = SCALE_SHIPS - 1;
  const now = core.clock.now();
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes, owner_ship_id)
    SELECT 'shp_' || lpad(i::text, 26, '0'), ${fleetId}, 'ship-' || i, 'agent', ${now}::timestamptz - interval '91 days', 'agent', '{}', ${argo.shipId}
    FROM generate_series(1, ${others}::int) i`;
  // Every ship crewed for a day under an open lease, pushed for the even ones, after an ended lease of its own.
  await core.prisma.$executeRaw`
    INSERT INTO leases (id, fleet_id, ship_id, location, started_at, pushed_at, ended_at)
    SELECT 'lse_' || lpad((2 * i + ended)::text, 26, '0'), ${fleetId}, 'shp_' || lpad(i::text, 26, '0'), 'DEVICE',
      ${now}::timestamptz - CASE WHEN ended = 1 THEN interval '60 days' ELSE interval '1 day' END,
      CASE WHEN ended = 0 AND i % 2 = 0 THEN ${now}::timestamptz - interval '1 day' END,
      CASE WHEN ended = 1 THEN ${now}::timestamptz - interval '30 days' END
    FROM generate_series(1, ${others}::int) i, generate_series(0, 1) ended`;
  // Message i: sender 1 + i % others, recipient 1 + (i + 7) % others; the old ones spread over 90 days, the open ones over the last half hour.
  await core.prisma.$executeRaw`
    CREATE TEMPORARY TABLE scale_seed AS
    SELECT i, 'shp_' || lpad((1 + i % ${others}::int)::text, 26, '0') AS sender,
      'shp_' || lpad((1 + (i + 7) % ${others}::int)::text, 26, '0') AS recipient,
      i > ${SCALE_MESSAGES - SCALE_OPEN}::int AS open,
      i <= ${SCALE_MESSAGES - SCALE_OPEN}::int AND i % ${UNDELIVERABLE_EVERY}::int = 0 AS undeliverable,
      CASE WHEN i > ${SCALE_MESSAGES - SCALE_OPEN}::int
        THEN ${now}::timestamptz - interval '30 minutes' + (i - ${SCALE_MESSAGES - SCALE_OPEN}::int) * interval '300 milliseconds'
        ELSE ${now}::timestamptz - interval '90 days' + i * interval '1 minute' END AS sent_at
    FROM generate_series(1, ${SCALE_MESSAGES}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
    SELECT 'msg_' || lpad(i::text, 26, '0'), ${fleetId}, sender, 'ship', recipient, 'hello', 'text/plain', 'seed-' || i, 'hash', sent_at
    FROM scale_seed`;
  await core.prisma.$executeRaw`
    INSERT INTO deliveries (id, fleet_id, message_id, sender_ship_id, recipient_ship_id, state, is_in_exchange, created_at)
    SELECT 'dlv_' || lpad(i::text, 26, '0'), ${fleetId}, 'msg_' || lpad(i::text, 26, '0'), sender, recipient,
      (CASE WHEN open AND i % ${RECEIVED_EVERY}::int = 0 THEN 'received' WHEN open THEN 'pending' WHEN undeliverable THEN 'undeliverable' ELSE 'dismissed' END)::delivery_state,
      true, sent_at
    FROM scale_seed`;
  // The open ones received are claimed under their recipient's open lease.
  await core.prisma.$executeRaw`
    UPDATE deliveries d SET claimed_by_lease_id = l.id, claimed_by_ship_id = l.ship_id
    FROM leases l
    WHERE d.fleet_id = ${fleetId} AND d.state = 'received' AND l.fleet_id = d.fleet_id AND l.ship_id = d.recipient_ship_id AND l.ended_at IS NULL`;
  // Each delivery's MessageAccepted by its sender at its send, then its receipt and dismissal by its recipient.
  await core.prisma.$executeRaw`
    INSERT INTO events (id, fleet_id, type, occurred_at, actor_kind, actor_ship_id, details, ship_id, message_id, delivery_id, seq)
    SELECT 'evt_' || lpad((3 * i + step)::text, 26, '0'), ${fleetId},
      (ARRAY['MessageAccepted', 'DeliveryReceived', CASE WHEN undeliverable THEN 'DeliveryUndeliverable' ELSE 'DeliveryDismissed' END])[step + 1],
      sent_at + step * interval '1 minute', 'ship', CASE WHEN step = 0 THEN sender ELSE recipient END, '{}', recipient,
      'msg_' || lpad(i::text, 26, '0'), 'dlv_' || lpad(i::text, 26, '0'), ${FIRST_SEQ}::bigint + 3 * i + step
    FROM scale_seed, generate_series(0, 2) step
    WHERE step = 0 OR NOT open OR (step = 1 AND i % ${RECEIVED_EVERY}::int = 0)`;
  const lastSeq = BigInt(FIRST_SEQ + 3 * SCALE_MESSAGES);
  await core.prisma.$executeRaw`UPDATE fleets SET last_event_seq = ${lastSeq} WHERE id = ${fleetId}`;
  await core.prisma.$executeRaw`DROP TABLE scale_seed`;
  await core.prisma.$executeRaw`ANALYZE`;
  return {
    fleetId,
    argo,
    shipId: (i) => idSchema('ship').parse(padded('shp_', i)),
    messageId: (i) => padded('msg_', i),
    deliveryId: (i) => padded('dlv_', i),
    lastSeq,
  };
}
