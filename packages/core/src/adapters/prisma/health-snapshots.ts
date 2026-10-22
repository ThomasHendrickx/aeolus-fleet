/**
 * The stuck snapshot on Postgres (docs/design/performance/performance.md,
 * section 5): `health_snapshots`, one row per fleet and closed hour, and
 * `health_snapshot_deliveries`, the open deliveries as of the latest. The
 * close takes a transaction-level advisory lock on the fleet's snapshot, so
 * two instances never close one fleet at once, and inserts each hour with
 * ON CONFLICT DO NOTHING as the backstop. A read takes the latest row and its
 * deliveries in one statement, so it never mixes two closes.
 */
import { deliveryStateSchema, idSchema, stuckCauseSchema, turnStateSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import { foldAt, type HealthFold } from '../../domain/shared/health-fold.js';
import type { HealthSnapshotWriter, HourSnapshot, StuckCount } from '../../domain/shared/health-snapshot.js';
import { stateStepOf, type DeliveryRecord, type DeliveryStep } from '../../domain/shared/stuck.js';
import type { Db } from './client.js';
import { deliveryRecordOf, deliveryRow, readCrews, recipientOf } from './health.js';
import { toSequencedEvent } from './rows.js';

const HOUR_MS = 60 * 60 * 1000;
/** How many closed hours a fleet keeps, the latest included. */
const KEPT_HOURS = 168;

const recipientJson = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ship'), shipId: idSchema('ship') }),
  z.object({ kind: z.literal('type'), type: z.string() }),
]);
const messageJson = z.object({ senderId: idSchema('ship'), recipient: recipientJson, claimedBy: idSchema('ship').nullable() });
const placeJson = z.discriminatedUnion('kind', [z.object({ kind: z.literal('ship'), shipId: idSchema('ship') }), z.object({ kind: z.literal('type'), type: z.string() })]);
const stuckJson = z.array(z.object({ cause: stuckCauseSchema, place: placeJson, message: messageJson, count: z.int(), oldestSince: z.coerce.date() }));
/** The waits as [bucket, count] pairs. */
const acknowledgedJson = z.array(z.object({ message: messageJson, waits: z.array(z.tuple([z.int(), z.int()])) }));
const turnsJson = z.array(z.object({ leaseId: idSchema('lease'), state: turnStateSchema, at: z.coerce.date() }));

const hourRow = z.object({ hour: z.date(), stuck: stuckJson, acknowledged: acknowledgedJson });

/** A row of health_snapshot_deliveries as json_agg answers it. */
const snapshotDeliveryJson = z.object({
  delivery_id: idSchema('delivery'),
  message_id: idSchema('message'),
  sender_ship_id: idSchema('ship'),
  recipient_ship_id: idSchema('ship').nullable(),
  recipient_type: z.string().nullable(),
  claimed_by_ship_id: idSchema('ship').nullable(),
  reachable_ship_ids: z.array(idSchema('ship')).nullable(),
  sent_at: z.coerce.date(),
  state: deliveryStateSchema.nullable(),
  since: z.coerce.date().nullable(),
  step_ship_id: idSchema('ship').nullable(),
  lease_id: idSchema('lease').nullable(),
});
const latestRow = z.object({ hour: z.date(), seq: z.bigint(), turns: turnsJson, deliveries: z.array(snapshotDeliveryJson) });

function deliveryOf(row: z.infer<typeof snapshotDeliveryJson>): DeliveryRecord {
  const steps = row.state === null || row.since === null ? [] : [{ state: row.state, at: row.since, shipId: row.step_ship_id, leaseId: row.lease_id }];
  return {
    deliveryId: row.delivery_id,
    messageId: row.message_id,
    senderId: row.sender_ship_id,
    recipient: recipientOf({ id: row.delivery_id, recipient_ship_id: row.recipient_ship_id, recipient_type: row.recipient_type }),
    claimedBy: row.claimed_by_ship_id,
    reachableShipIds: row.reachable_ship_ids ?? [],
    sentAt: row.sent_at,
    steps,
  };
}

function stuckToJson(stuck: readonly StuckCount[]): string {
  return JSON.stringify(stuck.map((counted) => ({ ...counted, oldestSince: counted.oldestSince.toISOString() })));
}

function acknowledgedToJson(acknowledged: HourSnapshot['acknowledged']): string {
  return JSON.stringify(acknowledged.map(({ message, waits }) => ({ message, waits: [...waits] })));
}

function turnsToJson(fold: HealthFold): string {
  return JSON.stringify(fold.turns.map(({ leaseId, turn }) => ({ leaseId, state: turn.state, at: turn.at.toISOString() })));
}

export function createPrismaHealthSnapshots(db: Db): HealthSnapshotWriter {
  const insertHour = async (fleetId: FleetId, row: { hour: HourSnapshot; seq: number; turns: string }): Promise<boolean> => {
    const { hour } = row;
    const inserted = await db.$executeRaw`
      INSERT INTO health_snapshots (fleet_id, hour, seq, stuck, acknowledged, turns)
      VALUES (${fleetId}, ${hour.hour}, ${BigInt(row.seq)}, ${stuckToJson(hour.stuck)}::jsonb, ${acknowledgedToJson(hour.acknowledged)}::jsonb, ${row.turns}::jsonb)
      ON CONFLICT (fleet_id, hour) DO NOTHING`;
    return inserted > 0;
  };

  return {
    latest: async (fleetId) => {
      const [row] = z.array(latestRow).parse(
        await db.$queryRaw`
          SELECT s.hour, s.seq, s.turns,
            COALESCE((SELECT json_agg(d) FROM health_snapshot_deliveries d WHERE d.fleet_id = ${fleetId}), '[]'::json) AS deliveries
          FROM (SELECT hour, seq, turns FROM health_snapshots WHERE fleet_id = ${fleetId} ORDER BY hour DESC LIMIT 1) s`,
      );
      if (row === undefined) {
        return undefined;
      }
      return {
        hour: row.hour,
        fold: { seq: Number(row.seq), deliveries: row.deliveries.map(deliveryOf), turns: row.turns.map(({ leaseId, state, at }) => ({ leaseId, turn: { state, at } })) },
      };
    },

    hours: async (fleetId, since) => {
      const rows = z.array(hourRow).parse(
        await db.$queryRaw`SELECT hour, stuck, acknowledged FROM health_snapshots WHERE fleet_id = ${fleetId} AND hour > ${since} ORDER BY hour`,
      );
      return rows.map((row) => ({ hour: row.hour, stuck: row.stuck, acknowledged: row.acknowledged.map(({ message, waits }) => ({ message, waits: new Map(waits) })) }));
    },

    eventsAfter: async (fleetId, { seq, limit }) => {
      const events = (await db.event.findMany({ where: { fleetId, seq: { gt: BigInt(seq) } }, orderBy: { seq: 'asc' }, ...(limit === undefined ? {} : { take: limit }) })).map(toSequencedEvent);
      const sentIds = events.flatMap((event) => (event.type === 'MessageAccepted' && event.deliveryId !== undefined ? [event.deliveryId] : []));
      const sent = z.array(deliveryRow).parse(
        sentIds.length === 0
          ? []
          : await db.$queryRaw`
              SELECT d.id, d.message_id, m.sender_ship_id, d.recipient_ship_id, d.recipient_type, NULL AS claimed_by_ship_id, d.reachable_ship_ids, d.created_at FROM deliveries d
              JOIN messages m ON m.fleet_id = d.fleet_id AND m.id = d.message_id
              WHERE d.fleet_id = ${fleetId} AND d.id = ANY(${sentIds}::text[])`,
      );
      return { events, sent: sent.map((row) => deliveryRecordOf(row, [])) };
    },

    crews: (fleetId, since) => readCrews(db, { fleetId, since }),

    tryLock: async (fleetId) => {
      const [row] = z
        .array(z.object({ locked: z.boolean() }))
        .parse(await db.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${fleetId}), hashtext('health-snapshot')) AS locked`);
      return row?.locked ?? false;
    },

    baseAt: async (fleetId, hour) => {
      const [last] = z.array(z.object({ seq: z.bigint() })).parse(
        await db.$queryRaw`
          SELECT COALESCE(
            (SELECT min(seq) - 1 FROM events WHERE fleet_id = ${fleetId} AND occurred_at > ${hour}),
            (SELECT last_event_seq FROM fleets WHERE id = ${fleetId})) AS seq`,
      );
      // Sent by then and open now, or with an event after it: what was open
      // then left since, so its leaving event is after the hour. Two indexed
      // parts, the open states' partial index and the events by time.
      const deliveries = z.array(deliveryRow).parse(
        await db.$queryRaw`
          SELECT d.id, d.message_id, m.sender_ship_id, d.recipient_ship_id, d.recipient_type, d.claimed_by_ship_id, d.reachable_ship_ids, d.created_at
          FROM (
            SELECT id FROM deliveries WHERE fleet_id = ${fleetId} AND state IN ('pending', 'received', 'handed', 'undeliverable') AND created_at <= ${hour}
            UNION
            SELECT delivery_id FROM events WHERE fleet_id = ${fleetId} AND occurred_at > ${hour} AND delivery_id IS NOT NULL
          ) c
          JOIN deliveries d ON d.fleet_id = ${fleetId} AND d.id = c.id
          JOIN messages m ON m.fleet_id = d.fleet_id AND m.id = d.message_id
          WHERE d.created_at <= ${hour}`,
      );
      const ids = deliveries.map((delivery) => delivery.id);
      const steps = new Map<string, DeliveryStep[]>();
      const events = await db.event.findMany({ where: { fleetId, deliveryId: { in: ids }, occurredAt: { lte: hour } }, orderBy: { seq: 'asc' } });
      for (const event of events.map(toSequencedEvent)) {
        const step = stateStepOf(event);
        if (step !== undefined && event.deliveryId !== undefined) {
          steps.set(event.deliveryId, [...(steps.get(event.deliveryId) ?? []), step]);
        }
      }
      // A lease's turn then, as the fold reads turns: its last TurnReported by
      // the hour, looked for back to the lease's start. A lease that never
      // reported a turn has none, so it is not looked for.
      const turns = z.array(z.object({ lease_id: idSchema('lease'), turn: turnStateSchema, at: z.date() })).parse(
        await db.$queryRaw`
          SELECT l.id AS lease_id, t.turn, t.occurred_at AS at FROM leases l
          CROSS JOIN LATERAL (
            SELECT e.details->>'turn' AS turn, e.occurred_at FROM events e
            WHERE e.fleet_id = l.fleet_id AND e.type = 'TurnReported' AND e.details->>'leaseId' = l.id AND e.occurred_at <= ${hour} AND e.occurred_at >= l.started_at
            ORDER BY e.occurred_at DESC LIMIT 1
          ) t
          WHERE l.fleet_id = ${fleetId} AND l.turn IS NOT NULL AND l.started_at <= ${hour} AND (l.ended_at IS NULL OR l.ended_at > ${hour})`,
      );
      const deliveriesThen = deliveries.map((delivery) => deliveryRecordOf(delivery, steps.get(delivery.id) ?? []));
      return {
        ...foldAt({ ships: [], leases: [], deliveries: deliveriesThen }, { at: hour, seq: Number(last?.seq ?? 0) }),
        turns: turns.map((turn) => ({ leaseId: turn.lease_id, turn: { state: turn.turn, at: turn.at } })),
      };
    },

    write: async (fleetId, { hours, fold }) => {
      const last = hours.at(-1);
      if (last === undefined) {
        return;
      }
      for (const hour of hours.slice(0, -1)) {
        await insertHour(fleetId, { hour, seq: fold.seq, turns: '[]' });
      }
      if (!(await insertHour(fleetId, { hour: last, seq: fold.seq, turns: turnsToJson(fold) }))) {
        return;
      }
      await db.healthSnapshotDelivery.deleteMany({ where: { fleetId } });
      await db.healthSnapshotDelivery.createMany({
        data: fold.deliveries.map((delivery) => {
          const step = delivery.steps.at(-1);
          return {
            fleetId,
            deliveryId: delivery.deliveryId,
            messageId: delivery.messageId,
            senderShipId: delivery.senderId,
            recipientShipId: delivery.recipient.kind === 'ship' ? delivery.recipient.shipId : null,
            recipientType: delivery.recipient.kind === 'type' ? delivery.recipient.type : null,
            claimedByShipId: delivery.claimedBy,
            reachableShipIds: [...delivery.reachableShipIds],
            sentAt: delivery.sentAt,
            state: step?.state ?? null,
            since: step?.at ?? null,
            stepShipId: step?.shipId ?? null,
            leaseId: step?.leaseId ?? null,
          };
        }),
      });
      const oldest = new Date(last.hour.getTime() - (KEPT_HOURS - 1) * HOUR_MS);
      await db.$executeRaw`DELETE FROM health_snapshots WHERE fleet_id = ${fleetId} AND hour < ${oldest}`;
    },
  };
}
