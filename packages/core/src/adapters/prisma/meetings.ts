import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { Meeting } from '../../domain/messaging/meeting.js';
import type { MeetingRepository } from '../../domain/messaging/ports.js';
import { pageOf } from '../../domain/shared/page.js';
import type { Db } from './client.js';
import { toMessage } from './rows.js';

const meetingRow = z.object({
  id: idSchema('meeting'),
  fleetId: idSchema('fleet'),
  ownerShipId: idSchema('ship'),
  moderatorShipId: idSchema('ship'),
  openedByShipId: idSchema('ship'),
  idempotencyKey: z.string(),
  requestHash: z.string(),
  openedAt: z.date(),
  endedAt: z.date().nullable(),
  participants: z.array(z.object({ shipId: idSchema('ship'), joinedAt: z.date() })),
});

/** A meeting row with its participants, as the meeting holds them: the opener first, then in the order they joined. */
function toMeeting(row: unknown): Meeting {
  return meetingRow.parse(row);
}

/** Each participant once, in the order they joined, the opener first. */
const PARTICIPANTS = { select: { shipId: true, joinedAt: true }, orderBy: { place: 'asc' } } as const;

/** Meetings on Postgres (decision 0061): a row per meeting and one per participant. */
export function createPrismaMeetingRepository(db: Db): MeetingRepository {
  return {
    create: async (meeting) => {
      const { participants, ...rest } = meeting;
      await db.meeting.create({ data: rest });
      await db.meetingParticipant.createMany({ data: participants.map((participant, place) => ({ fleetId: meeting.fleetId, meetingId: meeting.id, ...participant, place })) });
    },
    lockOpenerKey: async ({ openerShipId, idempotencyKey }) => {
      // A transaction-level advisory lock on the opener and its key, as a send's key is locked
      // (messaging.ts), in a namespace of its own so an open and a send never share one.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting:${openerShipId}`}), hashtext(${idempotencyKey}))`;
    },
    findByOpenerKey: async ({ fleetId, openerShipId, idempotencyKey }) => {
      const row = await db.meeting.findFirst({ where: { fleetId, openedByShipId: openerShipId, idempotencyKey }, include: { participants: PARTICIPANTS } });
      return row ? toMeeting(row) : undefined;
    },
    findForShare: async (fleetId, meetingId) => {
      // Held shared until the unit of work ends: contributions take turns with a change of who takes part.
      await db.$queryRaw`SELECT 1 FROM meetings WHERE fleet_id = ${fleetId} AND id = ${meetingId} FOR SHARE`;
      const row = await db.meeting.findFirst({ where: { fleetId, id: meetingId }, include: { participants: PARTICIPANTS } });
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
      const row = await db.meeting.findFirst({ where: { fleetId, id: meetingId }, include: { participants: PARTICIPANTS } });
      return row ? toMeeting(row) : undefined;
    },
  };
}
