/**
 * The 10 and 60 minute clocks on Postgres (decision 0040): what waits for the
 * open pushed leases, and what argo was told is overdue, once per lease and
 * delivery.
 */
import type { FleetId } from '@aeolus-fleet/common';

import type { OverdueDeliveryRepository, PushedCrews } from '../../domain/messaging/ports.js';
import type { Db } from './client.js';
import { toPushedCrewFromSql, toWaitingDeliveryFromSql } from './rows.js';

export function createPrismaPushedCrews(db: Db): PushedCrews {
  return {
    waiting: async (fleetId: FleetId) => {
      const leases = await db.$queryRaw<unknown[]>`
        SELECT l.id AS lease_id, l.ship_id, l.pushed_at, s.kind::text = 'person' AS is_person, l.turn::text AS turn, l.turn_at
        FROM leases l
        JOIN ships s ON s.fleet_id = l.fleet_id AND s.id = l.ship_id
        WHERE l.fleet_id = ${fleetId} AND l.ended_at IS NULL AND l.pushed_at IS NOT NULL`;
      if (leases.length === 0) {
        return [];
      }
      // A delivery waits for the lease when it is in flight with it, or
      // pending for its ship or, reachable, its type. It entered its state at
      // its latest return, receipt or hand-over; a receipt again and a hand-over
      // once more change no state, and without any it is pending since it was
      // stored.
      const waiting = await db.$queryRaw<unknown[]>`
        SELECT l.id AS lease_id, d.id AS delivery_id, d.message_id, d.state::text AS state, d.created_at,
               COALESCE((
                 SELECT max(e.occurred_at) FROM events e
                 WHERE e.fleet_id = d.fleet_id AND e.delivery_id = d.id
                   AND (e.type = 'DeliveryReturned'
                     OR (e.type = 'DeliveryReceived' AND e.details->>'again' IS DISTINCT FROM 'true')
                     OR (e.type = 'DeliveryHanded' AND e.details->>'onceMore' IS DISTINCT FROM 'true'))
               ), d.created_at) AS since
        FROM leases l
        JOIN ships s ON s.fleet_id = l.fleet_id AND s.id = l.ship_id
        JOIN deliveries d ON d.fleet_id = l.fleet_id AND (
          (d.state IN ('received', 'handed') AND d.claimed_by_lease_id = l.id)
          OR (d.state = 'pending' AND (
            d.recipient_ship_id = l.ship_id
            OR (d.recipient_type = s.type AND (cardinality(d.reachable_ship_ids) = 0 OR l.ship_id = ANY(d.reachable_ship_ids))))))
        WHERE l.fleet_id = ${fleetId} AND l.ended_at IS NULL AND l.pushed_at IS NOT NULL`;
      const crews = leases.map((row) => toPushedCrewFromSql(fleetId, row));
      for (const row of waiting) {
        const { leaseId, delivery } = toWaitingDeliveryFromSql(row);
        crews.find((crew) => crew.leaseId === leaseId)?.waiting.push(delivery);
      }
      return crews;
    },
  };
}

export function createPrismaOverdueDeliveryRepository(db: Db): OverdueDeliveryRepository {
  return {
    tell: async (overdue, at) => {
      const { fleetId, leaseId, shipId, delivery, clock, minutes } = overdue;
      // Stored only while the delivery is still in the state it was judged in,
      // with the lease still open: one confirmed or returned meanwhile is not
      // told. The key keeps it once per lease and delivery; a second pass at
      // once waits for the first one's row and then stores nothing.
      const stored = await db.$executeRaw`
        INSERT INTO overdue_deliveries (fleet_id, lease_id, delivery_id, ship_id, state, clock, minutes, told_at)
        SELECT d.fleet_id, l.id, d.id, ${shipId}, d.state, ${clock}::overdue_clock, ${minutes}, ${at}
        FROM deliveries d
        JOIN leases l ON l.fleet_id = d.fleet_id AND l.id = ${leaseId} AND l.ended_at IS NULL
        WHERE d.fleet_id = ${fleetId} AND d.id = ${delivery.deliveryId} AND d.state = ${delivery.state}::delivery_state
          AND (d.state = 'pending' OR d.claimed_by_lease_id = l.id)
        ON CONFLICT DO NOTHING`;
      return stored > 0;
    },
  };
}
