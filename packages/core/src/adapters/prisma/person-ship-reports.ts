/** The report candidates are only requested ids, permission-gated before every projection. */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { PersonPermissionPlan } from '../../domain/registry/person-permission.js';
import { harbourStateOfShip } from './harbour.js';
import { personPermissionSql } from './person-permission.js';
import { Prisma } from './generated/client.js';

export function personShipReportsStatement(fleetId: FleetId, read: { permission: PersonPermissionPlan | null; shipIds: readonly ShipId[] }): Prisma.Sql {
  const hasAlert = Prisma.sql`EXISTS (SELECT 1 FROM alerts alert WHERE alert.fleet_id = s.fleet_id AND alert.ship_id = s.id AND alert.cleared_at IS NULL OFFSET 0)`;
  return Prisma.sql`
    SELECT requested.id AS "shipId", s.id IS NOT NULL AS "isAvailable",
           ${harbourStateOfShip(hasAlert)} AS state, l.report_note AS note,
           GREATEST(activity.occurred_at, l.activity_at) AS "lastActivityAt"
    FROM unnest(${[...read.shipIds]}::text[]) WITH ORDINALITY requested(id, position)
    LEFT JOIN ships s ON s.fleet_id = ${fleetId} AND s.id = requested.id
      AND s.retired_at IS NULL AND s.removed_at IS NULL AND ${read.permission === null ? Prisma.sql`true` : personPermissionSql(read.permission)}
    LEFT JOIN leases l ON l.fleet_id = ${fleetId} AND l.fleet_id = s.fleet_id AND l.ship_id = s.id AND l.ended_at IS NULL
    LEFT JOIN LATERAL (
      SELECT event.occurred_at FROM events event
      WHERE event.fleet_id = ${fleetId} AND event.actor_ship_id = s.id
        AND event.type IN ('MessageAccepted', 'DeliveryAcknowledged')
      ORDER BY event.seq DESC LIMIT 1
    ) activity ON true
    ORDER BY requested.position`;
}
