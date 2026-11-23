import { idSchema, meetingListEntrySchema, micPatternSchema, readMeetingsCursor, type FleetId, type MeetingId, type ShipId } from '@aeolus-fleet/common';
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
    listOf: async (fleetId, query) => {
      const rows = await db.$queryRaw<unknown[]>(meetingListStatement(fleetId, query));
      return pageOf(z.array(listedMeetingRow).parse(rows), { limit: query.limit, cursorOf: meetingListCursor });
    },
    create: async (meeting) => {
      const { participants, micRequests, ...rest } = meeting;
      await db.meeting.create({ data: rest });
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
        where: { fleetId, meetingId, selectorKind: 'meeting', ...(cursor === undefined ? {} : { id: { lt: cursor } }) },
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
