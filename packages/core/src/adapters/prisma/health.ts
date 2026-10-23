/**
 * The health records on Postgres (decision 0042): the ships, leases and
 * deliveries the stuck rule replays, read from their tables and the delivery
 * events, and the deliveries acknowledged in a window. The replay a fleet's
 * first stuck snapshot is written from, and the read until it has one.
 */
import { eventTypeSchema, idSchema, shipKindSchema, turnStateSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { HealthCrews } from '../../domain/shared/health-snapshot.js';
import type { HealthRecords } from '../../domain/shared/health.js';
import { isConsoleShip } from '../../domain/registry/public.js';
import { STEP_EVENT_TYPES, stateStepOf, type DeliveryRecord, type DeliveryStep, type LeaseTurn } from '../../domain/shared/stuck.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

const shipRow = z.object({
  id: idSchema('ship'),
  name: z.string(),
  type: z.string(),
  kind: shipKindSchema,
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

export const deliveryRow = z.object({
  id: idSchema('delivery'),
  message_id: idSchema('message'),
  sender_ship_id: idSchema('ship'),
  recipient_ship_id: idSchema('ship').nullable(),
  claimed_by_ship_id: idSchema('ship').nullable(),
  recipient_type: z.string().nullable(),
  reachable_ship_ids: z.array(idSchema('ship')),
  created_at: z.date(),
});

const machineRow = z.object({ ship_id: idSchema('ship'), machine_id: idSchema('ship'), machine_name: z.string(), last_seen_at: z.date().nullable() });

const acknowledgedRow = z.object({
  sent_at: z.date(),
  acknowledged_at: z.date(),
  id: idSchema('delivery'),
  sender_ship_id: idSchema('ship'),
  recipient_ship_id: idSchema('ship').nullable(),
  recipient_type: z.string().nullable(),
  claimed_by_ship_id: idSchema('ship').nullable(),
});

/** A delivery as the stuck rule reads it, from its row and its steps. */
export function deliveryRecordOf(row: z.infer<typeof deliveryRow>, steps: readonly DeliveryStep[]): DeliveryRecord {
  return {
    deliveryId: row.id,
    messageId: row.message_id,
    senderId: row.sender_ship_id,
    recipient: recipientOf(row),
    claimedBy: row.claimed_by_ship_id,
    reachableShipIds: row.reachable_ship_ids,
    sentAt: row.created_at,
    steps,
  };
}

export function recipientOf(row: Pick<z.infer<typeof deliveryRow>, 'id' | 'recipient_ship_id' | 'recipient_type'>): DeliveryRecord['recipient'] {
  if (row.recipient_ship_id !== null) {
    return { kind: 'ship', shipId: row.recipient_ship_id };
  }
  if (row.recipient_type !== null) {
    return { kind: 'type', type: row.recipient_type };
  }
  throw new Error(`Delivery ${row.id} has no recipient`);
}

/** The fleet's ships and leases not over before `since`, each lease with no turns, and the machine behind each ship whose crew request is assigned. */
export async function readCrews(db: Db, read: { fleetId: FleetId; since: Date }): Promise<HealthCrews> {
  const { fleetId, since } = read;
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
      isAlwaysCrewed: isConsoleShip(ship),
      isPerson: ship.kind === 'person',
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
      turns: [],
    })),
    machines: machines.map((row) => ({ shipId: row.ship_id, machine: { id: row.machine_id, name: row.machine_name, lastSeenAt: row.last_seen_at } })),
  };
}

/** The open states, as the deliveries' partial index lists them, so a read of them uses it. */
const OPEN_STATES_SQL = Prisma.sql`('pending', 'received', 'handed', 'undeliverable')`;

/** A step event of a delivery, as `deliveriesWithStepsStatement` aggregates it. */
const stepEventJson = z.object({
  type: eventTypeSchema,
  occurredAt: z.coerce.date(),
  shipId: idSchema('ship').nullable(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
const deliveryWithStepsRow = deliveryRow.extend({ steps: z.array(stepEventJson) });

/**
 * The deliveries `candidates` names (a statement of delivery ids), each with
 * its message's sender and its step events oldest first, up to `upTo` if
 * given. Each candidate's delivery, message and steps are read by key
 * (LIMIT 1 keeps each a lookup Postgres cannot turn into a scan of every
 * delivery or message of the fleet, decision 1 of docs/design/performance/
 * performance.md), so the cost follows the candidates, and no IN list of
 * every candidate travels to Postgres and back.
 */
function deliveriesWithStepsStatement(fleetId: FleetId, read: { candidates: Prisma.Sql; upTo?: Date }): Prisma.Sql {
  const { candidates, upTo } = read;
  const sentBy = upTo === undefined ? Prisma.sql`` : Prisma.sql`AND d.created_at <= ${upTo}`;
  const stepsBy = upTo === undefined ? Prisma.sql`` : Prisma.sql`AND e.occurred_at <= ${upTo}`;
  return Prisma.sql`
    WITH candidates AS (${candidates})
    SELECT d.id, d.message_id, m.sender_ship_id, d.recipient_ship_id, d.recipient_type, d.claimed_by_ship_id, d.reachable_ship_ids, d.created_at,
      COALESCE(s.steps, '[]'::json) AS steps
    FROM candidates c
    CROSS JOIN LATERAL (SELECT * FROM deliveries d WHERE d.fleet_id = ${fleetId} AND d.id = c.id ${sentBy} LIMIT 1) d
    CROSS JOIN LATERAL (SELECT m.sender_ship_id FROM messages m WHERE m.fleet_id = ${fleetId} AND m.id = d.message_id LIMIT 1) m
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('type', e.type, 'occurredAt', e.occurred_at, 'shipId', e.ship_id, 'details', e.details) ORDER BY e.seq) AS steps
      FROM events e
      WHERE e.fleet_id = ${fleetId} AND e.delivery_id = d.id AND e.type = ANY(${[...STEP_EVENT_TYPES]}::text[]) ${stepsBy}
    ) s ON true`;
}

/**
 * The replay's deliveries: open now, or with a step since `since`, as a
 * delivery that left its stuck state since then has the event that took it
 * out. Two parts, each through its own index (the open states' partial
 * index, the events by time), joined as a UNION: as one OR, Postgres scans
 * every delivery and message of the fleet.
 */
export function replayDeliveriesStatement(fleetId: FleetId, since: Date): Prisma.Sql {
  return deliveriesWithStepsStatement(fleetId, {
    candidates: Prisma.sql`
      SELECT id FROM deliveries WHERE fleet_id = ${fleetId} AND state IN ${OPEN_STATES_SQL}
      UNION
      SELECT delivery_id FROM events WHERE fleet_id = ${fleetId} AND occurred_at >= ${since} AND delivery_id IS NOT NULL`,
  });
}

/**
 * The deliveries the first snapshot's base looks up at `hour`: sent by then,
 * and open now or with an event after it, since what was open then and left
 * since has its leaving event after it. The events after the hour are mostly
 * of deliveries sent after it, whose MessageAccepted (written at their send)
 * is among them, so they are dropped in the one scan of those events by time
 * and only the deliveries sent by the hour are looked up.
 */
export function baseCandidatesStatement(fleetId: FleetId, hour: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT id FROM deliveries WHERE fleet_id = ${fleetId} AND state IN ${OPEN_STATES_SQL} AND created_at <= ${hour}
    UNION
    SELECT delivery_id FROM events WHERE fleet_id = ${fleetId} AND occurred_at > ${hour} AND delivery_id IS NOT NULL
    GROUP BY delivery_id HAVING bool_and(type <> 'MessageAccepted')`;
}

/** The first snapshot's deliveries at `hour`, each with its steps up to the hour only, which is all the fold reads of it. */
export function baseDeliveriesStatement(fleetId: FleetId, hour: Date): Prisma.Sql {
  return deliveriesWithStepsStatement(fleetId, { candidates: baseCandidatesStatement(fleetId, hour), upTo: hour });
}

/** The deliveries a `deliveriesWithStepsStatement` answers, as the stuck rule reads them. */
export async function readDeliveriesWithSteps(db: Db, statement: Prisma.Sql): Promise<DeliveryRecord[]> {
  const rows = z.array(deliveryWithStepsRow).parse(await db.$queryRaw(statement));
  return rows.map(({ steps, ...row }) =>
    deliveryRecordOf(
      row,
      steps.flatMap(({ shipId, ...event }) => {
        const step = stateStepOf({ ...event, ...(shipId === null ? {} : { shipId }) });
        return step === undefined ? [] : [step];
      }),
    ),
  );
}

export function createPrismaHealthRecords(db: Db): HealthRecords {
  return {
    read: async (fleetId: FleetId, since: Date) => {
      const crews = await readCrews(db, { fleetId, since });
      const leaseIds = crews.leases.map((lease) => lease.leaseId);
      const turns = z.array(turnRow).parse(
        await db.$queryRaw`
          SELECT details->>'leaseId' AS lease_id, details->>'turn' AS turn, occurred_at FROM events
          WHERE fleet_id = ${fleetId} AND type = 'TurnReported' AND details->>'leaseId' = ANY(${leaseIds}::text[])
          ORDER BY seq`,
      );
      const deliveries = await readDeliveriesWithSteps(db, replayDeliveriesStatement(fleetId, since));
      return {
        ...crews,
        leases: crews.leases.map((lease) => ({
          ...lease,
          turns: turns.filter((turn) => turn.lease_id === lease.leaseId).map((turn): LeaseTurn => ({ state: turn.turn, at: turn.occurred_at })),
        })),
        deliveries,
      };
    },

    acknowledged: async (fleetId, since) => {
      const rows = z.array(acknowledgedRow).parse(
        await db.$queryRaw`
          SELECT d.created_at AS sent_at, e.occurred_at AS acknowledged_at, d.id, m.sender_ship_id, d.recipient_ship_id, d.recipient_type, d.claimed_by_ship_id
          FROM events e
          JOIN deliveries d ON d.fleet_id = e.fleet_id AND d.id = e.delivery_id
          JOIN messages m ON m.fleet_id = d.fleet_id AND m.id = d.message_id
          WHERE e.fleet_id = ${fleetId} AND e.type = 'DeliveryAcknowledged' AND e.occurred_at > ${since}`,
      );
      return rows.map((row) => ({
        sentAt: row.sent_at,
        acknowledgedAt: row.acknowledged_at,
        message: { senderId: row.sender_ship_id, recipient: recipientOf(row), claimedBy: row.claimed_by_ship_id },
      }));
    },
  };
}
