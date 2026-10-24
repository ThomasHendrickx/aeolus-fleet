import { idSchema, micPatternSchema, type FleetId, type MeetingId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { Meeting } from '../../domain/messaging/meeting.js';
import type { MicRequest } from '../../domain/messaging/mic.js';
import type { MeetingRepository } from '../../domain/messaging/ports.js';
import { pageOf } from '../../domain/shared/page.js';
import type { Db } from './client.js';
import { toMessage } from './rows.js';

const meetingRow = z.object({
  id: idSchema('meeting'),
  fleetId: idSchema('fleet'),
  title: z.string().nullable(),
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
    create: async (meeting) => {
      const { participants, micRequests, ...rest } = meeting;
      await db.meeting.create({ data: rest });
      await db.meetingParticipant.createMany({ data: participants.map((participant, place) => ({ fleetId: meeting.fleetId, meetingId: meeting.id, ...participant, place })) });
      await saveRequests(db, { fleetId: meeting.fleetId, meetingId: meeting.id, requests: micRequests });
    },
    findForUpdate: async (fleetId, meetingId) => {
      // Held for update until the unit of work ends: mic changes take turns, after the contributions holding it shared.
      await db.$queryRaw`SELECT 1 FROM meetings WHERE fleet_id = ${fleetId} AND id = ${meetingId} FOR UPDATE`;
      const row = await db.meeting.findFirst({ where: { fleetId, id: meetingId }, include: PARTICIPANTS_AND_REQUESTS });
      return row ? toMeeting(row) : undefined;
    },
    save: async ({ fleetId, id, ownerShipId, moderatorShipId, endedAt, micHolderShipId, micPattern, participants, micRequests }) => {
      await db.meeting.update({ where: { fleetId_id: { fleetId, id } }, data: { ownerShipId, moderatorShipId, endedAt, micHolderShipId, micPattern } });
      await db.meetingMicRequest.deleteMany({ where: { fleetId, meetingId: id } });
      for (const [place, { shipId, joinedAt, leftAt, isRevoked }] of participants.entries()) {
        await db.meetingParticipant.upsert({
          where: { fleetId_meetingId_shipId: { fleetId, meetingId: id, shipId } },
          create: { fleetId, meetingId: id, shipId, joinedAt, leftAt, isRevoked, place },
          update: { joinedAt, leftAt, isRevoked, place },
        });
      }
      await saveRequests(db, { fleetId, meetingId: id, requests: micRequests });
    },
    listPresentInForUpdate: async (fleetId, shipId) => {
      // Held for update until the unit of work ends, in id order so two retires never lock in a cycle;
      // found through meeting_participants_fleet_id_ship_id_idx.
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
    findForShare: async (fleetId, meetingId) => {
      // Held shared until the unit of work ends: contributions take turns with a change of who takes part.
      await db.$queryRaw`SELECT 1 FROM meetings WHERE fleet_id = ${fleetId} AND id = ${meetingId} FOR SHARE`;
      const row = await db.meeting.findFirst({ where: { fleetId, id: meetingId }, include: PARTICIPANTS_AND_REQUESTS });
      return row ? toMeeting(row) : undefined;
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
