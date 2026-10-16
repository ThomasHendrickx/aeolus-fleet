/**
 * The health records on Postgres (decision 0042): the ships, leases and
 * deliveries the stuck rule replays, read from their tables and the delivery
 * events, and the deliveries acknowledged in a window. No
 * table of its own: a read, never stored.
 */
import { idSchema, turnStateSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { HealthRecords } from '../../domain/shared/health.js';
import { stateStepOf, type DeliveryRecord, type DeliveryStep, type LeaseTurn } from '../../domain/shared/stuck.js';
import type { Db } from './client.js';
import { toSequencedEvent } from './rows.js';

const shipRow = z.object({
  id: idSchema('ship'),
  name: z.string(),
  type: z.string(),
  kind: z.string(),
  created_at: z.date(),
  retired_at: z.date().nullable(),
});

const leaseRow = z.object({
  id: idSchema('lease'),
  ship_id: idSchema('ship'),
  started_at: z.date(),
  ended_at: z.date().nullable(),
  pushed_at: z.date().nullable(),
  last_seen_at: z.date(),
});

const turnRow = z.object({ lease_id: z.string(), turn: turnStateSchema, occurred_at: z.date() });

const deliveryRow = z.object({
  id: idSchema('delivery'),
  recipient_ship_id: idSchema('ship').nullable(),
  recipient_type: z.string().nullable(),
  reachable_ship_ids: z.array(idSchema('ship')),
  created_at: z.date(),
});

const machineRow = z.object({ ship_id: idSchema('ship'), machine_id: idSchema('ship'), machine_name: z.string(), last_seen_at: z.date().nullable() });

const acknowledgedRow = z.object({ sent_at: z.date(), acknowledged_at: z.date() });

function recipientOf(row: z.infer<typeof deliveryRow>): DeliveryRecord['recipient'] {
  if (row.recipient_ship_id !== null) {
    return { kind: 'ship', shipId: row.recipient_ship_id };
  }
  if (row.recipient_type !== null) {
    return { kind: 'type', type: row.recipient_type };
  }
  throw new Error(`Delivery ${row.id} has no recipient`);
}

export function createPrismaHealthRecords(db: Db): HealthRecords {
  return {
    read: async (fleetId: FleetId, since: Date) => {
      const ships = z.array(shipRow).parse(
        await db.$queryRaw`
          SELECT id, name, type, kind::text AS kind, created_at, retired_at FROM ships
          WHERE fleet_id = ${fleetId} AND (retired_at IS NULL OR retired_at >= ${since})`,
      );
      // A lease never seen is last seen when it started, as the ship page reads it.
      const leases = z.array(leaseRow).parse(
        await db.$queryRaw`
          SELECT id, ship_id, started_at, ended_at, pushed_at, COALESCE(last_seen_at, started_at) AS last_seen_at FROM leases
          WHERE fleet_id = ${fleetId} AND (ended_at IS NULL OR ended_at >= ${since})`,
      );
      const leaseIds = leases.map((lease) => lease.id);
      const turns = z.array(turnRow).parse(
        await db.$queryRaw`
          SELECT details->>'leaseId' AS lease_id, details->>'turn' AS turn, occurred_at FROM events
          WHERE fleet_id = ${fleetId} AND type = 'TurnReported' AND details->>'leaseId' = ANY(${leaseIds}::text[])
          ORDER BY seq`,
      );
      // Open now, or with a step in the window: a delivery that left its
      // stuck state since then has the event that took it out.
      const deliveries = z.array(deliveryRow).parse(
        await db.$queryRaw`
          SELECT d.id, d.recipient_ship_id, d.recipient_type, d.reachable_ship_ids, d.created_at FROM deliveries d
          WHERE d.fleet_id = ${fleetId}
            AND (d.state IN ('pending', 'received', 'handed', 'undeliverable')
              OR d.id IN (SELECT e.delivery_id FROM events e WHERE e.fleet_id = ${fleetId} AND e.occurred_at >= ${since} AND e.delivery_id IS NOT NULL))`,
      );
      const steps = new Map<string, DeliveryStep[]>();
      const events = await db.event.findMany({ where: { fleetId, deliveryId: { in: deliveries.map((delivery) => delivery.id) } }, orderBy: { seq: 'asc' } });
      for (const event of events.map(toSequencedEvent)) {
        const step = stateStepOf(event);
        if (step !== undefined && event.deliveryId !== undefined) {
          steps.set(event.deliveryId, [...(steps.get(event.deliveryId) ?? []), step]);
        }
      }
      const machines = z.array(machineRow).parse(
        await db.$queryRaw`
          SELECT c.ship_id, m.id AS machine_id, m.name AS machine_name, COALESCE(l.last_seen_at, l.started_at) AS last_seen_at
          FROM crew_requests c
          JOIN ships m ON m.fleet_id = c.fleet_id AND m.id = c.assigned_to_ship_id
          LEFT JOIN leases l ON l.fleet_id = m.fleet_id AND l.ship_id = m.id AND l.ended_at IS NULL
          WHERE c.fleet_id = ${fleetId}`,
      );
      return {
        ships: ships.map((ship) => ({
          shipId: ship.id,
          name: ship.name,
          type: ship.type,
          isAlwaysCrewed: ship.kind !== 'agent',
          commissionedAt: ship.created_at,
          retiredAt: ship.retired_at,
        })),
        leases: leases.map((lease) => ({
          leaseId: lease.id,
          shipId: lease.ship_id,
          startedAt: lease.started_at,
          endedAt: lease.ended_at,
          pushedAt: lease.pushed_at,
          lastSeenAt: lease.last_seen_at,
          turns: turns.filter((turn) => turn.lease_id === lease.id).map((turn): LeaseTurn => ({ state: turn.turn, at: turn.occurred_at })),
        })),
        deliveries: deliveries.map((delivery) => ({
          deliveryId: delivery.id,
          recipient: recipientOf(delivery),
          reachableShipIds: delivery.reachable_ship_ids,
          sentAt: delivery.created_at,
          steps: steps.get(delivery.id) ?? [],
        })),
        machines: machines.map((row) => ({ shipId: row.ship_id, machine: { id: row.machine_id, name: row.machine_name, lastSeenAt: row.last_seen_at } })),
      };
    },

    acknowledged: async (fleetId, since) => {
      const rows = z.array(acknowledgedRow).parse(
        await db.$queryRaw`
          SELECT d.created_at AS sent_at, e.occurred_at AS acknowledged_at
          FROM events e
          JOIN deliveries d ON d.fleet_id = e.fleet_id AND d.id = e.delivery_id
          WHERE e.fleet_id = ${fleetId} AND e.type = 'DeliveryAcknowledged' AND e.occurred_at > ${since}`,
      );
      return rows.map((row) => ({ sentAt: row.sent_at, acknowledgedAt: row.acknowledged_at }));
    },
  };
}
