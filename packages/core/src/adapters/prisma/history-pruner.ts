/**
 * The pruning pass on Postgres (docs/design/retention/retention.md, R2 to R4,
 * R6 to R8, R12, R13 and R16; decision 0070 for retired ships). A batch takes a transaction-level advisory lock on the
 * fleet's pruning with try, so a second server skips the fleet, and locks the
 * messages it reads and their deliveries FOR UPDATE SKIP LOCKED before it
 * reads what decides: a row another transaction holds is skipped, and its
 * message marked locked, waiting for the next pass; the rows that go by age
 * are locked the same way, a held one left for the next pass, as are the
 * retired ships it removes. The one step that makes a
 * set go deletes it children first, its events under the transaction-local
 * setting `aeolus.pruning_fleet`, the only way events go apart from a fleet's
 * delete.
 */
import { ANSWER_CONTENT_TYPE, deliveryStateSchema, idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { CREW_EVENT_TYPES, type HistoryPruner, type PruneCandidate } from '../../domain/shared/history-pruning.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

/** The crew event types as SQL literals, so the query's filter matches the events_crew_idx partial index. */
const CREW_EVENT_TYPES_SQL = Prisma.raw(CREW_EVENT_TYPES.map((type) => `'${type}'`).join(', '));

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
    agedRows: async (fleetId, { cutoff, messageIds, limit }) => {
      const ids = <T extends 'event' | 'lease' | 'credential' | 'consoleSession' | 'reachRefusal'>(kind: T, rows: unknown) =>
        z
          .array(z.object({ id: idSchema(kind) }))
          .parse(rows)
          .map((row) => row.id);
      // Through the events_crew_idx partial index; only events the newest
      // snapshot folded (R7), as a message's events are.
      const eventIds = ids(
        'event',
        await db.$queryRaw`
          SELECT e.id FROM events e
          WHERE e.fleet_id = ${fleetId} AND e.type IN (${CREW_EVENT_TYPES_SQL}) AND e.occurred_at < ${cutoff}
            AND e.message_id IS NULL AND e.delivery_id IS NULL
            AND e.seq <= COALESCE((SELECT seq FROM health_snapshots WHERE fleet_id = ${fleetId} ORDER BY hour DESC LIMIT 1), 0)
          ORDER BY e.occurred_at
          LIMIT ${limit}`,
      );
      const consoleSessionIds = ids(
        'consoleSession',
        await db.$queryRaw`
          SELECT id FROM console_sessions WHERE fleet_id = ${fleetId} AND (ended_at < ${cutoff} OR expires_at < ${cutoff})
          LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
      );
      // An ended lease goes only when no row outside the set names it: a
      // delivery, an overdue row or a console session (R4).
      const leaseIds = ids(
        'lease',
        await db.$queryRaw`
          SELECT l.id FROM leases l
          WHERE l.fleet_id = ${fleetId} AND l.ended_at < ${cutoff}
            AND NOT EXISTS (
              SELECT 1 FROM deliveries d
              WHERE d.fleet_id = ${fleetId} AND d.claimed_by_lease_id = l.id AND NOT (d.message_id = ANY(${[...messageIds]}::text[]))
            )
            AND NOT EXISTS (
              SELECT 1 FROM overdue_deliveries o JOIN deliveries d ON d.fleet_id = o.fleet_id AND d.id = o.delivery_id
              WHERE o.fleet_id = ${fleetId} AND o.lease_id = l.id AND NOT (d.message_id = ANY(${[...messageIds]}::text[]))
            )
            AND NOT EXISTS (
              SELECT 1 FROM console_sessions s
              WHERE s.fleet_id = ${fleetId} AND s.lease_id = l.id AND NOT (s.id = ANY(${consoleSessionIds}::text[]))
            )
          ORDER BY l.ended_at LIMIT ${limit} FOR UPDATE OF l SKIP LOCKED`,
      );
      const credentialIds = ids(
        'credential',
        await db.$queryRaw`
          SELECT id FROM credentials WHERE fleet_id = ${fleetId} AND invalidated_at < ${cutoff}
          ORDER BY invalidated_at LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
      );
      const signInTicketHashes = z
        .array(z.object({ tokenHash: z.string() }))
        .parse(
          await db.$queryRaw`
            SELECT token_hash AS "tokenHash" FROM sign_in_tickets WHERE fleet_id = ${fleetId} AND (used_at < ${cutoff} OR expires_at < ${cutoff})
            LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
        )
        .map((row) => row.tokenHash);
      const reachRefusalIds = ids(
        'reachRefusal',
        await db.$queryRaw`SELECT id FROM reach_refusals WHERE fleet_id = ${fleetId} AND at < ${cutoff} ORDER BY id LIMIT ${limit}`,
      );
      return { eventIds, leaseIds, credentialIds, consoleSessionIds, signInTicketHashes, reachRefusalIds };
    },
    retiredShips: async (fleetId, { cutoff, limit }) => {
      // Through the ships_removal_idx partial index.
      const rows = z.array(z.object({ id: idSchema('ship') })).parse(
        await db.$queryRaw`
          SELECT id FROM ships
          WHERE fleet_id = ${fleetId} AND retired_at < ${cutoff} AND removed_at IS NULL
          ORDER BY retired_at, id LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
      );
      return rows.map((row) => row.id);
    },
    go: async (fleetId, set) => {
      const messageIds = [...set.messageIds];
      const meetingEventIds = [...set.meetingEventIds];
      const consoleSessionIds = [...set.consoleSessionIds];
      await db.$queryRaw`SELECT set_config('aeolus.pruning_fleet', ${fleetId}, true)`;
      // Storage is what the fleet holds now (R6): each message's payload bytes
      // come off its UTC day, as the send counted them, a sealed one's plain
      // byte count (decision 0068); the day's count stays.
      await db.$executeRaw`
        UPDATE message_days md SET payload_bytes = md.payload_bytes - gone.bytes
        FROM (
          SELECT (created_at AT TIME ZONE 'UTC')::date AS day, sum(coalesce(octet_length(payload), sealed_payload_bytes))::bigint AS bytes
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
      const crewEvents = await db.$executeRaw`DELETE FROM events WHERE fleet_id = ${fleetId} AND id = ANY(${[...set.eventIds]}::text[])`;
      const overdueDeliveries = await db.$executeRaw`DELETE FROM overdue_deliveries WHERE fleet_id = ${fleetId} AND delivery_id = ANY(${deliveryIds})`;
      const deliveries = await db.$executeRaw`DELETE FROM deliveries WHERE fleet_id = ${fleetId} AND id = ANY(${deliveryIds})`;
      const messages = await db.$executeRaw`DELETE FROM messages WHERE fleet_id = ${fleetId} AND id = ANY(${messageIds})`;
      const noticeDismissals = await db.$executeRaw`DELETE FROM notice_dismissals WHERE fleet_id = ${fleetId} AND console_session_id = ANY(${consoleSessionIds}::text[])`;
      const guideProgress = await db.$executeRaw`DELETE FROM guide_progress WHERE fleet_id = ${fleetId} AND console_session_id = ANY(${consoleSessionIds}::text[])`;
      const consoleSessions = await db.$executeRaw`DELETE FROM console_sessions WHERE fleet_id = ${fleetId} AND id = ANY(${consoleSessionIds}::text[])`;
      const leases = await db.$executeRaw`DELETE FROM leases WHERE fleet_id = ${fleetId} AND id = ANY(${[...set.leaseIds]}::text[])`;
      const credentials = await db.$executeRaw`DELETE FROM credentials WHERE fleet_id = ${fleetId} AND id = ANY(${[...set.credentialIds]}::text[])`;
      const signInTickets = await db.$executeRaw`DELETE FROM sign_in_tickets WHERE fleet_id = ${fleetId} AND token_hash = ANY(${[...set.signInTicketHashes]}::text[])`;
      const reachRefusals = await db.$executeRaw`DELETE FROM reach_refusals WHERE fleet_id = ${fleetId} AND id = ANY(${[...set.reachRefusalIds]}::text[])`;
      // The remnant (decision 0070, D2): every row naming the ship keeps its foreign key.
      const ships = await db.$executeRaw`
        UPDATE ships SET removed_at = ${set.removedAt}, scopes = '{}', note = NULL, owner_ship_id = NULL,
          commissioned_by_kind = NULL, commissioned_by = NULL, commission_key = NULL, commission_request_hash = NULL
        WHERE fleet_id = ${fleetId} AND id = ANY(${[...set.shipIds]}::text[]) AND removed_at IS NULL`;
      return {
        messages,
        deliveries,
        events: messageEvents + deliveryEvents + meetingEvents + crewEvents,
        overdueDeliveries,
        leases,
        credentials,
        consoleSessions,
        noticeDismissals,
        guideProgress,
        signInTickets,
        reachRefusals,
        ships,
      };
    },
    keepFrom: async (fleetId, at) => {
      await db.$executeRaw`UPDATE fleets SET kept_from = ${at} WHERE id = ${fleetId}`;
    },
  };
}
