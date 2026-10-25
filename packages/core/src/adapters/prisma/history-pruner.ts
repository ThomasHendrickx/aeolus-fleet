/**
 * The pruning pass on Postgres (docs/design/retention/retention.md, R2, R6,
 * R7, R8, R12 and R16). A batch takes a transaction-level advisory lock on the
 * fleet's pruning with try, so a second server skips the fleet, and locks the
 * messages it reads and their deliveries FOR UPDATE SKIP LOCKED before it
 * reads what decides: a row another transaction holds is skipped, and its
 * message marked locked, waiting for the next pass. The one step that makes a
 * set go deletes it children first, its events under the transaction-local
 * setting `aeolus.pruning_fleet`, the only way events go apart from a fleet's
 * delete.
 */
import { ANSWER_CONTENT_TYPE, deliveryStateSchema, idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { HistoryPruner, PruneCandidate } from '../../domain/shared/history-pruning.js';
import type { Db } from './client.js';

const idRows = z.array(z.object({ id: idSchema('message') }));

const candidateRows = z.array(
  z.object({
    id: idSchema('message'),
    createdAt: z.date(),
    contentType: z.string(),
    isAnswered: z.boolean(),
    meeting: z.enum(['none', 'open', 'ended']),
    isNamedBySchedule: z.boolean(),
    hasUnfoldedEvent: z.boolean(),
    deliveries: z.int(),
  }),
);

const deliveryRows = z.array(
  z.object({
    messageId: idSchema('message'),
    state: deliveryStateSchema,
    claimingLease: z.enum(['none', 'ended', 'open', 'openPushed']),
  }),
);

export function createPrismaHistoryPruner(db: Db): HistoryPruner {
  return {
    claimPass: async (fleetId, { at, dueBefore }) => {
      const claimed = await db.$executeRaw`
        UPDATE fleets SET pruned_at = ${at}
        WHERE id = ${fleetId} AND (pruned_at IS NULL OR pruned_at <= ${dueBefore})`;
      return claimed === 1;
    },
    newestSnapshotHour: async (fleetId) => {
      const [row] = z.array(z.object({ hour: z.date().nullable() })).parse(await db.$queryRaw`SELECT max(hour) AS hour FROM health_snapshots WHERE fleet_id = ${fleetId}`);
      return row?.hour ?? undefined;
    },
    tryLock: async (fleetId) => {
      const [row] = z
        .array(z.object({ locked: z.boolean() }))
        .parse(await db.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${fleetId}), hashtext('history-pruning')) AS locked`);
      if (!row?.locked) {
        return false;
      }
      // The fleet's row too, as a key share: a fleet's delete, which locks the
      // row for update first, then waits for the batch instead of meeting it
      // halfway in a deadlock; sends, which update the row's event sequence,
      // do not wait for it.
      await db.$queryRaw`SELECT id FROM fleets WHERE id = ${fleetId} FOR KEY SHARE`;
      return true;
    },
    candidates: async (fleetId, { cutoff, after, limit }) => {
      // The oldest messages before the cutoff after the cursor, through the
      // (fleet_id, created_at) index.
      const ids = idRows
        .parse(
          await db.$queryRaw`
            SELECT id FROM messages
            WHERE fleet_id = ${fleetId} AND created_at < ${cutoff}
              AND (${after?.createdAt ?? null}::timestamptz IS NULL OR (created_at, id) > (${after?.createdAt ?? null}::timestamptz, ${after?.id ?? null}::text))
            ORDER BY created_at, id
            LIMIT ${limit}`,
        )
        .map((row) => row.id);
      if (ids.length === 0) {
        return [];
      }
      // Locked first, so what decides is read under the lock.
      const lockedIds = idRows.parse(await db.$queryRaw`SELECT id FROM messages WHERE fleet_id = ${fleetId} AND id = ANY(${ids}) FOR UPDATE SKIP LOCKED`).map((row) => row.id);
      const deliveries = deliveryRows.parse(
        await db.$queryRaw`
          SELECT d.message_id AS "messageId", d.state::text AS state,
            CASE WHEN l.id IS NULL THEN 'none' WHEN l.ended_at IS NOT NULL THEN 'ended' WHEN l.pushed_at IS NOT NULL THEN 'openPushed' ELSE 'open' END AS "claimingLease"
          FROM deliveries d
          LEFT JOIN leases l ON l.fleet_id = d.fleet_id AND l.id = d.claimed_by_lease_id
          WHERE d.fleet_id = ${fleetId} AND d.message_id = ANY(${ids})
          FOR UPDATE OF d SKIP LOCKED`,
      );
      const messages = candidateRows.parse(
        await db.$queryRaw`
          SELECT m.id, m.created_at AS "createdAt", m.content_type AS "contentType",
            EXISTS (
              SELECT 1 FROM messages a WHERE a.fleet_id = ${fleetId} AND a.in_reply_to_message_id = m.id AND a.content_type = ${ANSWER_CONTENT_TYPE}
            ) AS "isAnswered",
            CASE WHEN m.meeting_id IS NULL THEN 'none' WHEN mt.ended_at IS NULL THEN 'open' ELSE 'ended' END AS meeting,
            (
              EXISTS (SELECT 1 FROM schedules s WHERE s.fleet_id = ${fleetId} AND s.in_reply_to_message_id = m.id)
              OR EXISTS (SELECT 1 FROM schedules s WHERE s.fleet_id = ${fleetId} AND s.last_message_id = m.id)
            ) AS "isNamedBySchedule",
            -- An event numbered after the newest snapshot's fold, of the
            -- message or of one of its deliveries (R7). Events take their
            -- numbers in commit order and this reads after the deliveries are
            -- locked: an acknowledgement committed before the lock is seen
            -- here, and one after it waits for the batch.
            (
              EXISTS (SELECT 1 FROM events e WHERE e.fleet_id = ${fleetId} AND e.message_id = m.id AND e.seq > folded.seq)
              OR EXISTS (
                SELECT 1 FROM deliveries d JOIN events e ON e.fleet_id = d.fleet_id AND e.delivery_id = d.id
                WHERE d.fleet_id = ${fleetId} AND d.message_id = m.id AND e.seq > folded.seq
              )
            ) AS "hasUnfoldedEvent",
            (SELECT count(*)::int FROM deliveries d WHERE d.fleet_id = ${fleetId} AND d.message_id = m.id) AS deliveries
          FROM messages m
          LEFT JOIN meetings mt ON mt.fleet_id = m.fleet_id AND mt.id = m.meeting_id
          CROSS JOIN (
            SELECT COALESCE((SELECT seq FROM health_snapshots WHERE fleet_id = ${fleetId} ORDER BY hour DESC LIMIT 1), 0) AS seq
          ) folded
          WHERE m.fleet_id = ${fleetId} AND m.id = ANY(${ids})
          ORDER BY m.created_at, m.id`,
      );
      return messages.map(({ deliveries: count, ...message }): PruneCandidate => {
        const own = deliveries.filter((delivery) => delivery.messageId === message.id).map(({ state, claimingLease }) => ({ state, claimingLease }));
        return { ...message, isLocked: !lockedIds.includes(message.id) || own.length < count, deliveries: own };
      });
    },
    meetingEvents: async (fleetId, { cutoff, limit }) => {
      // Through the events_meeting_parts_idx partial index.
      const rows = z.array(z.object({ id: idSchema('event') })).parse(
        await db.$queryRaw`
          SELECT e.id
          FROM events e
          JOIN meetings mt ON mt.fleet_id = e.fleet_id AND mt.id = e.details->>'meetingId'
          WHERE e.fleet_id = ${fleetId}
            AND e.type IN ('ParticipantAdded', 'ParticipantLeft', 'ParticipantRejoined', 'ParticipantRevoked', 'MicRequested', 'MicRequestWithdrawn', 'MicGiven', 'MicReleased', 'MicTaken', 'MicPatternSet')
            AND mt.ended_at < ${cutoff}
          ORDER BY e.seq
          LIMIT ${limit}`,
      );
      return rows.map((row) => row.id);
    },
    go: async (fleetId, set) => {
      const messageIds = [...set.messageIds];
      const meetingEventIds = [...set.meetingEventIds];
      await db.$queryRaw`SELECT set_config('aeolus.pruning_fleet', ${fleetId}, true)`;
      // Storage is what the fleet holds now (R6): each message's payload bytes
      // come off its UTC day, as the send counted them; the day's count stays.
      await db.$executeRaw`
        UPDATE message_days md SET payload_bytes = md.payload_bytes - gone.bytes
        FROM (
          SELECT (created_at AT TIME ZONE 'UTC')::date AS day, sum(octet_length(payload))::bigint AS bytes
          FROM messages WHERE fleet_id = ${fleetId} AND id = ANY(${messageIds})
          GROUP BY 1
        ) gone
        WHERE md.fleet_id = ${fleetId} AND md.day = gone.day`;
      const deliveryIds = z
        .array(z.object({ id: z.string() }))
        .parse(await db.$queryRaw`SELECT id FROM deliveries WHERE fleet_id = ${fleetId} AND message_id = ANY(${messageIds})`)
        .map((row) => row.id);
      // Children first: every foreign key restricts deletes.
      const messageEvents = await db.$executeRaw`DELETE FROM events WHERE fleet_id = ${fleetId} AND message_id = ANY(${messageIds})`;
      const deliveryEvents = await db.$executeRaw`DELETE FROM events WHERE fleet_id = ${fleetId} AND delivery_id = ANY(${deliveryIds})`;
      const meetingEvents = await db.$executeRaw`DELETE FROM events WHERE fleet_id = ${fleetId} AND id = ANY(${meetingEventIds})`;
      const overdueDeliveries = await db.$executeRaw`DELETE FROM overdue_deliveries WHERE fleet_id = ${fleetId} AND delivery_id = ANY(${deliveryIds})`;
      const deliveries = await db.$executeRaw`DELETE FROM deliveries WHERE fleet_id = ${fleetId} AND id = ANY(${deliveryIds})`;
      const messages = await db.$executeRaw`DELETE FROM messages WHERE fleet_id = ${fleetId} AND id = ANY(${messageIds})`;
      return { messages, deliveries, events: messageEvents + deliveryEvents + meetingEvents, overdueDeliveries };
    },
    keepFrom: async (fleetId, at) => {
      await db.$executeRaw`UPDATE fleets SET kept_from = ${at} WHERE id = ${fleetId}`;
    },
  };
}
