import { idSchema, meetingListEntrySchema, micPatternSchema, readMeetingsCursor, type FleetId, type MeetingId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { z } from 'zod';

import { meetingListCursor } from '../../domain/messaging/meeting-list.js';
import type { Meeting } from '../../domain/messaging/meeting.js';
import type { MicRequest } from '../../domain/messaging/mic.js';
import type { MeetingRepository } from '../../domain/messaging/ports.js';
import type { PageQuery } from '../../domain/shared/page.js';
import { pageOf } from '../../domain/shared/page.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';
import { toMessage } from './rows.js';

const meetingRow = z.object({
  id: idSchema('meeting'),
  fleetId: idSchema('fleet'),
  title: z.string().nullable(),
  goal: z.string().nullable(),
  endsAt: z.date().nullable(),
  endAfterCalls: z.int().nullable(),
  ownerShipId: idSchema('ship'),
  moderatorShipId: idSchema('ship'),
  openedByShipId: idSchema('ship'),
  idempotencyKey: z.string(),
  requestHash: z.string(),
  openedAt: z.date(),
  endedAt: z.date().nullable(),
  micHolderShipId: idSchema('ship').nullable(),
  micPattern: micPatternSchema,
  participants: z.array(z.object({ shipId: idSchema('ship'), joinedAt: z.date(), leftAt: z.date().nullable(), isRevoked: z.boolean() })),
  micRequests: z.array(z.object({ shipId: idSchema('ship'), requestedAt: z.date() })),
});

/** A meeting row with its participants, as the meeting holds them: the opener first, then in the order they joined. */
function toMeeting(row: unknown): Meeting {
  return meetingRow.parse(row);
}

/** Each participant once, in the order they joined, the opener first; and the mic requests, oldest first. */
const PARTICIPANTS_AND_REQUESTS = {
  participants: { select: { shipId: true, joinedAt: true, leftAt: true, isRevoked: true }, orderBy: { place: 'asc' } },
  micRequests: { select: { shipId: true, requestedAt: true }, orderBy: { place: 'asc' } },
} as const;

/** Meetings on Postgres (decision 0061): a row per meeting and one per participant. */
export function createPrismaMeetingRepository(db: Db): MeetingRepository {
  return {
    progressPage: async (fleetId, query) => {
      const rows = await db.$queryRaw<unknown[]>(callProgressStatement(fleetId, query));
      const facts = z.array(z.object({ shipId: idSchema('ship'), deliveredAt: z.date().nullable(), acknowledgedAt: z.date().nullable(), isAcknowledged: z.boolean() })).parse(rows);
      return pageOf(facts, { limit: query.limit, cursorOf: (row) => row.shipId });
    },
    createCall: async (call) => {
      await db.meetingCall.create({ data: callRow.parse(call) });
      await db.$executeRaw`SELECT pg_notify(${MEETING_DEADLINE_CHANNEL}, ${call.deadline.toISOString()})`;
    },
    saveCall: async (call) => { await db.meetingCall.update({ where: { fleetId_id: { fleetId: call.fleetId, id: call.id } }, data: { closedAt: call.closedAt, silentShipIds: call.silentShipIds } }); },
    findCall: async (fleetId, { meetingId, callId }) => {
      const row = await db.meetingCall.findFirst({ where: { fleetId, meetingId, id: callId } });
      return row === null ? undefined : callWithAnswers(db, row);
    },
    latestCall: async (fleetId, meetingId) => {
      const row = await db.meetingCall.findFirst({ where: { fleetId, meetingId }, orderBy: { id: 'desc' } });
      return row === null ? undefined : callWithAnswers(db, row);
    },
    closedCallCount: (fleetId, meetingId) => db.meetingCall.count({ where: { fleetId, meetingId, closedAt: { not: null } } }),
    claimDue: async (fleetId, { at, tried }) => {
      const excluded = tried.length === 0 ? Prisma.empty : Prisma.sql`AND m.id NOT IN (${Prisma.join([...tried])})`;
      const rows = await db.$queryRaw<unknown[]>`
        WITH due AS (
          SELECT id, ends_at AS at FROM meetings
          WHERE fleet_id = ${fleetId} AND ended_at IS NULL AND ends_at IS NOT NULL AND ends_at <= ${at}
          UNION ALL
          SELECT meeting_id AS id, deadline AS at FROM meeting_calls
          WHERE fleet_id = ${fleetId} AND closed_at IS NULL AND deadline <= ${at}
        )
        SELECT m.id FROM meetings m
        JOIN due d ON d.id = m.id
        WHERE m.fleet_id = ${fleetId} AND m.ended_at IS NULL ${excluded}
        ORDER BY d.at, m.id LIMIT 1 FOR UPDATE OF m SKIP LOCKED`;
      const row = z.array(z.object({ id: idSchema('meeting') })).parse(rows)[0];
      if (row === undefined) return undefined;
      const meeting = await db.meeting.findFirst({ where: { fleetId, id: row.id }, include: PARTICIPANTS_AND_REQUESTS });
      return meeting === null ? undefined : toMeeting(meeting);
    },
    nextEndTime: async (fleetId) => {
      const rows = await db.$queryRaw<unknown[]>`SELECT MIN(at) AS at FROM (
        SELECT MIN(ends_at) AS at FROM meetings WHERE fleet_id = ${fleetId} AND ended_at IS NULL AND ends_at IS NOT NULL
        UNION ALL
        (SELECT c.deadline AS at FROM meeting_calls c
        WHERE c.fleet_id = ${fleetId} AND c.closed_at IS NULL
          AND EXISTS (SELECT 1 FROM meetings m WHERE m.fleet_id = c.fleet_id AND m.id = c.meeting_id AND m.ended_at IS NULL)
        ORDER BY c.deadline, c.meeting_id LIMIT 1)
      ) deadlines`;
      return z.array(z.object({ at: z.date().nullable() })).parse(rows)[0]?.at ?? undefined;
    },
    listOf: async (fleetId, query) => {
      const rows = await db.$queryRaw<unknown[]>(meetingListStatement(fleetId, query));
      return pageOf(z.array(listedMeetingRow).parse(rows), { limit: query.limit, cursorOf: meetingListCursor });
    },
    create: async (meeting) => {
      const { participants, micRequests, ...rest } = meeting;
      await db.meeting.create({ data: rest });
      if (meeting.endsAt !== null) {
        await db.$executeRaw`SELECT pg_notify(${MEETING_DEADLINE_CHANNEL}, ${meeting.endsAt.toISOString()})`;
      }
      await db.meetingParticipant.createMany({ data: participants.map((participant, place) => ({ fleetId: meeting.fleetId, meetingId: meeting.id, ...participant, place, meetingOpenedAt: meeting.openedAt, isMeetingEnded: meeting.endedAt !== null })) });
      await saveRequests(db, { fleetId: meeting.fleetId, meetingId: meeting.id, requests: micRequests });
    },
    findForUpdate: async (fleetId, meetingId) => {
      // Held for update until the unit of work ends: mic changes take turns, after the contributions in flight.
      await db.$queryRaw`SELECT 1 FROM meetings WHERE fleet_id = ${fleetId} AND id = ${meetingId} FOR UPDATE`;
      const row = await db.meeting.findFirst({ where: { fleetId, id: meetingId }, include: PARTICIPANTS_AND_REQUESTS });
      return row ? toMeeting(row) : undefined;
    },
    save: async ({ fleetId, id, ownerShipId, moderatorShipId, openedAt, endedAt, micHolderShipId, micPattern, participants, micRequests }) => {
      await db.meeting.update({ where: { fleetId_id: { fleetId, id } }, data: { ownerShipId, moderatorShipId, endedAt, micHolderShipId, micPattern } });
      if (endedAt !== null) await db.meetingCall.updateMany({ where: { fleetId, meetingId: id, closedAt: null }, data: { closedAt: endedAt } });
      await db.meetingMicRequest.deleteMany({ where: { fleetId, meetingId: id } });
      for (const [place, { shipId, joinedAt, leftAt, isRevoked }] of participants.entries()) {
        await db.meetingParticipant.upsert({
          where: { fleetId_meetingId_shipId: { fleetId, meetingId: id, shipId } },
          create: { fleetId, meetingId: id, shipId, joinedAt, leftAt, isRevoked, place, meetingOpenedAt: openedAt, isMeetingEnded: endedAt !== null },
          update: { joinedAt, leftAt, isRevoked, place, isMeetingEnded: endedAt !== null },
        });
      }
      await saveRequests(db, { fleetId, meetingId: id, requests: micRequests });
    },
    listPresentInForUpdate: async (fleetId, shipId) => {
      // Held for update until the unit of work ends, in id order so two retires never lock in a cycle;
      // found through meeting_participants_ship_list_idx.
      const rows = await db.$queryRaw<unknown[]>`
        SELECT m.id FROM meetings m
        JOIN meeting_participants p ON p.fleet_id = m.fleet_id AND p.meeting_id = m.id
        WHERE m.fleet_id = ${fleetId} AND p.ship_id = ${shipId} AND p.left_at IS NULL AND m.ended_at IS NULL
        ORDER BY m.id
        FOR UPDATE OF m`;
      const meetings = await db.meeting.findMany({ where: { fleetId, id: { in: z.array(z.object({ id: idSchema('meeting') })).parse(rows).map((row) => row.id) } }, include: PARTICIPANTS_AND_REQUESTS, orderBy: { id: 'asc' } });
      return meetings.map(toMeeting);
    },
    lockOpenerKey: async ({ openerShipId, idempotencyKey }) => {
      // A transaction-level advisory lock on the opener and its key, as a send's key is locked
      // (messaging.ts), in a namespace of its own so an open and a send never share one.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting:${openerShipId}`}), hashtext(${idempotencyKey}))`;
    },
    findByOpenerKey: async ({ fleetId, openerShipId, idempotencyKey }) => {
      const row = await db.meeting.findFirst({ where: { fleetId, openedByShipId: openerShipId, idempotencyKey }, include: PARTICIPANTS_AND_REQUESTS });
      return row ? toMeeting(row) : undefined;
    },
    findForNoKeyUpdate: async (fleetId, meetingId) => {
      // Held for no key update from the start: two contributions never upgrade shared locks into a deadlock.
      await db.$queryRaw`SELECT 1 FROM meetings WHERE fleet_id = ${fleetId} AND id = ${meetingId} FOR NO KEY UPDATE`;
      const row = await db.meeting.findFirst({ where: { fleetId, id: meetingId }, include: PARTICIPANTS_AND_REQUESTS });
      return row ? toMeeting(row) : undefined;
    },
    contributed: async (fleetId, { meetingId, at }) => {
      await db.$executeRaw`UPDATE meetings SET last_contribution_at = GREATEST(last_contribution_at, ${at}) WHERE fleet_id = ${fleetId} AND id = ${meetingId}`;
    },
    contributions: async (fleetId, { meetingId, cursor, limit }) => {
      // Read newest first through messages_fleet_id_meeting_id_id_idx; a notice names the meeting too, but is sent to a ship.
      const rows = await db.message.findMany({
        where: { fleetId, meetingId, selectorKind: 'meeting', contentType: { not: 'application/vnd.aeolus.meeting.call+json' }, ...(cursor === undefined ? {} : { id: { lt: cursor } }) },
        orderBy: { id: 'desc' },
        take: limit + 1,
      });
      return pageOf(rows.map(toMessage), { limit, cursorOf: (message) => message.id });
    },
    find: async (fleetId, meetingId) => {
      const row = await db.meeting.findFirst({ where: { fleetId, id: meetingId }, include: PARTICIPANTS_AND_REQUESTS });
      return row ? toMeeting(row) : undefined;
    },
  };
}

/** The mic requests as rows, each with its place on the list. */
async function saveRequests(db: Db, { fleetId, meetingId, requests }: { fleetId: FleetId; meetingId: MeetingId; requests: readonly MicRequest[] }): Promise<void> {
  await db.meetingMicRequest.createMany({ data: requests.map((request, place) => ({ fleetId, meetingId, ...request, place })) });
}


const listedMeetingRow = meetingListEntrySchema.extend({
  openedAt: z.date(), endedAt: z.date().nullable(), lastContributionAt: z.date().nullable(),
});

/** Two limited index ranges before joins: at most 2 x (limit + 1) participant entries, whatever the ship's history. */
export function meetingListStatement(fleetId: FleetId, query: { shipId: ShipId } & PageQuery<string>): Prisma.Sql {
  const cursor = query.cursor === undefined ? undefined : readMeetingsCursor(query.cursor);
  const openPosition = cursor === undefined ? Prisma.empty : cursor.section === 'e'
    ? Prisma.sql`AND false`
    : Prisma.sql`AND (p.meeting_opened_at, p.meeting_id) < (${cursor.openedAt}, ${cursor.meetingId})`;
  const endedPosition = cursor?.section === 'e'
    ? Prisma.sql`AND (p.meeting_opened_at, p.meeting_id) < (${cursor.openedAt}, ${cursor.meetingId})` : Prisma.empty;
  const take = query.limit + 1;
  // OFFSET 0 keeps the meeting lookup per page row: at limit 100 Postgres otherwise
  // chooses a hash join scanning every meeting, despite the bounded participant ranges.
  return Prisma.sql`
    WITH page AS (
      (SELECT p.meeting_id, p.is_meeting_ended, p.meeting_opened_at, p.left_at, p.is_revoked
       FROM meeting_participants p
       WHERE p.fleet_id = ${fleetId} AND p.ship_id = ${query.shipId} AND p.is_meeting_ended = false ${openPosition}
       ORDER BY p.meeting_opened_at DESC, p.meeting_id DESC LIMIT ${take})
      UNION ALL
      (SELECT p.meeting_id, p.is_meeting_ended, p.meeting_opened_at, p.left_at, p.is_revoked
       FROM meeting_participants p
       WHERE p.fleet_id = ${fleetId} AND p.ship_id = ${query.shipId} AND p.is_meeting_ended = true ${endedPosition}
       ORDER BY p.meeting_opened_at DESC, p.meeting_id DESC LIMIT ${take})
      ORDER BY is_meeting_ended, meeting_opened_at DESC, meeting_id DESC LIMIT ${take}
    )
    SELECT page.meeting_id AS "meetingId", m.title, m.opened_at AS "openedAt", m.ended_at AS "endedAt",
      m.last_contribution_at AS "lastContributionAt",
      json_build_object('id', o.id, 'name', o.name) AS owner,
      json_build_object('id', d.id, 'name', d.name) AS moderator,
      CASE WHEN h.id IS NULL THEN NULL ELSE json_build_object('id', h.id, 'name', h.name) END AS "micHolder",
      (SELECT count(*)::int FROM meeting_participants q
       WHERE q.fleet_id = m.fleet_id AND q.meeting_id = m.id AND q.left_at IS NULL) AS "presentParticipants",
      (SELECT r.place + 1 FROM meeting_mic_requests r
       WHERE r.fleet_id = m.fleet_id AND r.meeting_id = m.id AND r.ship_id = ${query.shipId}) AS "placeInLine",
      CASE WHEN page.is_revoked THEN 'revoked' WHEN page.left_at IS NULL THEN 'present' ELSE 'left' END AS "participantState"
    FROM page
    JOIN LATERAL (
      SELECT id, fleet_id, title, opened_at, ended_at, last_contribution_at,
        owner_ship_id, moderator_ship_id, mic_holder_ship_id
      FROM meetings WHERE fleet_id = ${fleetId} AND id = page.meeting_id OFFSET 0
    ) m ON true
    JOIN ships o ON o.fleet_id = m.fleet_id AND o.id = m.owner_ship_id
    JOIN ships d ON d.fleet_id = m.fleet_id AND d.id = m.moderator_ship_id
    LEFT JOIN ships h ON h.fleet_id = m.fleet_id AND h.id = m.mic_holder_ship_id
    ORDER BY page.is_meeting_ended, page.meeting_opened_at DESC, page.meeting_id DESC`;
}


/** A committed opening tells every core server to arm its deadline timer. */
export const MEETING_DEADLINE_CHANNEL = 'aeolus_meeting_deadline';


const callRow = z.object({
  id: idSchema('message'), fleetId: idSchema('fleet'), meetingId: idSchema('meeting'),
  requestHash: z.string(), expectedShipIds: z.array(idSchema('ship')), silentShipIds: z.array(idSchema('ship')), deadline: z.date(), openedAt: z.date(), closedAt: z.date().nullable(),
});

/** The message envelope is the sole stored relationship between an answer and its call. */
async function callWithAnswers(db: Db, row: unknown) {
  const call = callRow.parse(row);
  const answers = await db.message.findMany({
    where: { fleetId: call.fleetId, meetingId: call.meetingId, callId: call.id },
    select: { senderShipId: true, id: true, isLate: true },
    orderBy: { id: 'asc' },
  });
  return { ...call, answers: answers.map((message) => ({ shipId: idSchema('ship').parse(message.senderShipId), messageId: idSchema('message').parse(message.id), ...(message.isLate ? { isLate: true } : {}) })) };
}


/** Page the fixed expected list before looking up its unique deliveries and indexed acknowledgement events. */
export function callProgressStatement(fleetId: FleetId, query: { callId: MessageId } & PageQuery<ShipId>): Prisma.Sql {
  return Prisma.sql`
    WITH page AS MATERIALIZED (
      SELECT expected.ship_id FROM meeting_calls c
      CROSS JOIN LATERAL unnest(c.expected_ship_ids) expected(ship_id)
      WHERE c.fleet_id = ${fleetId} AND c.id = ${query.callId}
        AND expected.ship_id > ${query.cursor ?? ''}
      ORDER BY expected.ship_id LIMIT ${query.limit + 1}
    )
    SELECT page.ship_id AS "shipId", d.created_at AS "deliveredAt",
      ack.occurred_at AS "acknowledgedAt", (ack.occurred_at IS NOT NULL) AS "isAcknowledged"
    FROM page
    LEFT JOIN deliveries d ON d.fleet_id = ${fleetId} AND d.message_id = ${query.callId} AND d.recipient_ship_id = page.ship_id
    LEFT JOIN LATERAL (
      SELECT occurred_at FROM events e
      WHERE e.fleet_id = ${fleetId} AND e.delivery_id = d.id AND e.type = 'DeliveryAcknowledged'
      ORDER BY e.seq LIMIT 1
    ) ack ON true
    ORDER BY page.ship_id`;
}
