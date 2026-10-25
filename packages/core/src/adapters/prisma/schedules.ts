import { idSchema, refusalStrategySchema, scheduleStateSchema, type ScheduleId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { ScheduleAttempts, ScheduleNotice, ScheduleNotifier, ScheduleRepository } from '../../domain/messaging/ports.js';
import type { Schedule, ScheduleOutcome } from '../../domain/messaging/schedule.js';
import { pageOf } from '../../domain/shared/page.js';
import type { RecipientSelector } from '../../domain/shared/selector.js';
import type { Db, PrismaClient } from './client.js';

/** The one channel every server's schedule timer listens on (decision 0062). */
export const SCHEDULE_DUE_CHANNEL = 'aeolus_schedule_due';

const scheduleRow = z.object({
  id: idSchema('schedule'),
  fleetId: idSchema('fleet'),
  shipId: idSchema('ship'),
  selectorKind: z.enum(['ship', 'type']),
  selectorShipId: idSchema('ship').nullable(),
  selectorShipName: z.string().nullable(),
  selectorType: z.string().nullable(),
  payload: z.string(),
  contentType: z.string(),
  model: z.string().nullable(),
  inReplyToMessageId: idSchema('message').nullable(),
  isForced: z.boolean(),
  timingKind: z.literal('once'),
  onceAt: z.date(),
  onRefused: refusalStrategySchema,
  retryWindow: z.string(),
  idempotencyKey: z.string(),
  requestHash: z.string(),
  state: scheduleStateSchema,
  nextSendTime: z.date().nullable(),
  nextAttemptAt: z.date().nullable(),
  lastOutcomeKind: z.enum(['sent', 'refused']).nullable(),
  lastMessageId: idSchema('message').nullable(),
  lastRefusalCode: z.string().nullable(),
  lastSendTime: z.date().nullable(),
  lastOutcomeAt: z.date().nullable(),
  createdAt: z.date(),
  endedAt: z.date().nullable(),
  cancelledAt: z.date().nullable(),
});

type ScheduleRow = z.infer<typeof scheduleRow>;

function selectorOf(row: ScheduleRow): RecipientSelector {
  if (row.selectorKind === 'type' && row.selectorType !== null) {
    return { kind: 'type', type: row.selectorType };
  }
  if (row.selectorShipId !== null) {
    return { kind: 'ship', shipId: row.selectorShipId };
  }
  if (row.selectorShipName !== null) {
    return { kind: 'ship', name: row.selectorShipName };
  }
  throw new Error(`Schedule ${row.id} has no selector`);
}

function outcomeOf(row: ScheduleRow): ScheduleOutcome | null {
  const { lastOutcomeKind, lastMessageId, lastRefusalCode, lastSendTime, lastOutcomeAt } = row;
  if (lastOutcomeKind === null || lastSendTime === null || lastOutcomeAt === null) {
    return null;
  }
  if (lastOutcomeKind === 'sent' && lastMessageId !== null) {
    return { kind: 'sent', messageId: lastMessageId, sendTime: lastSendTime, at: lastOutcomeAt };
  }
  return { kind: 'refused', code: lastRefusalCode ?? '', sendTime: lastSendTime, at: lastOutcomeAt };
}

/** A schedules row as the schedule holds it; the table's checks keep its selector and outcome whole. */
function toSchedule(raw: unknown): Schedule {
  const row = scheduleRow.parse(raw);
  return {
    id: row.id,
    fleetId: row.fleetId,
    shipId: row.shipId,
    send: { selector: selectorOf(row), payload: row.payload, contentType: row.contentType, model: row.model, inReplyTo: row.inReplyToMessageId, isForced: row.isForced },
    timing: { kind: row.timingKind, at: row.onceAt },
    onRefused: row.onRefused,
    retryWindow: row.retryWindow,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    state: row.state,
    nextSendTime: row.nextSendTime,
    nextAttemptAt: row.nextAttemptAt,
    lastOutcome: outcomeOf(row),
    createdAt: row.createdAt,
    endedAt: row.endedAt,
    cancelledAt: row.cancelledAt,
  };
}

/** The columns a schedule changes after it is made. */
function changingColumns(schedule: Schedule) {
  const outcome = schedule.lastOutcome;
  return {
    state: schedule.state,
    nextSendTime: schedule.nextSendTime,
    nextAttemptAt: schedule.nextAttemptAt,
    lastOutcomeKind: outcome?.kind ?? null,
    lastMessageId: outcome?.kind === 'sent' ? outcome.messageId : null,
    lastRefusalCode: outcome?.kind === 'refused' ? outcome.code : null,
    lastSendTime: outcome?.sendTime ?? null,
    lastOutcomeAt: outcome?.at ?? null,
    endedAt: schedule.endedAt,
    cancelledAt: schedule.cancelledAt,
  };
}

const idRows = z.array(z.object({ id: idSchema('schedule') }));

/** Schedules on Postgres (decision 0062): one row per schedule; locks and the claim in raw SQL. */
export function createPrismaScheduleRepository(db: Db): ScheduleRepository {
  const find = async (fleetId: Schedule['fleetId'], scheduleId: ScheduleId) => {
    const row = await db.schedule.findFirst({ where: { fleetId, id: scheduleId } });
    return row ? toSchedule(row) : undefined;
  };
  return {
    create: async (schedule) => {
      const { selector } = schedule.send;
      await db.schedule.create({
        data: {
          id: schedule.id,
          fleetId: schedule.fleetId,
          shipId: schedule.shipId,
          selectorKind: selector.kind,
          selectorShipId: 'shipId' in selector ? selector.shipId : null,
          selectorShipName: 'name' in selector ? selector.name : null,
          selectorType: selector.kind === 'type' ? selector.type : null,
          payload: schedule.send.payload,
          contentType: schedule.send.contentType,
          model: schedule.send.model,
          inReplyToMessageId: schedule.send.inReplyTo,
          isForced: schedule.send.isForced,
          timingKind: schedule.timing.kind,
          onceAt: schedule.timing.at,
          onRefused: schedule.onRefused,
          retryWindow: schedule.retryWindow,
          idempotencyKey: schedule.idempotencyKey,
          requestHash: schedule.requestHash,
          createdAt: schedule.createdAt,
          ...changingColumns(schedule),
        },
      });
    },
    lockCreatorKey: async ({ shipId, idempotencyKey }) => {
      // A transaction-level advisory lock on the creator and its key, as a send's key is locked
      // (messaging.ts), in a namespace of its own so a schedule and a send never share one.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`schedule:${shipId}`}), hashtext(${idempotencyKey}))`;
    },
    findByCreatorKey: async ({ fleetId, shipId, idempotencyKey }) => {
      const row = await db.schedule.findFirst({ where: { fleetId, shipId, idempotencyKey } });
      return row ? toSchedule(row) : undefined;
    },
    findForUpdate: async (fleetId, scheduleId) => {
      await db.$queryRaw`SELECT 1 FROM schedules WHERE fleet_id = ${fleetId} AND id = ${scheduleId} FOR UPDATE`;
      return find(fleetId, scheduleId);
    },
    claimDue: async (fleetId, excluding) => {
      // Due by the database's clock, so servers whose clocks differ agree; through schedules_due_idx.
      // SKIP LOCKED: a schedule another server holds is its to send, never waited for (ADR 0003).
      const rows = await db.$queryRaw<unknown[]>`
        SELECT id FROM schedules
        WHERE fleet_id = ${fleetId} AND state = 'active'::schedule_state AND next_attempt_at <= now()
          AND NOT (id = ANY(${[...excluding]}::text[]))
        ORDER BY next_attempt_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      const [claimed] = idRows.parse(rows);
      return claimed && find(fleetId, claimed.id);
    },
    save: async (schedule) => {
      await db.schedule.update({ where: { fleetId_id: { fleetId: schedule.fleetId, id: schedule.id } }, data: changingColumns(schedule) });
    },
    listOpenOfShipForUpdate: async (fleetId, shipId) => {
      // Held for update in id order, so two units of work never lock them in a cycle.
      const rows = await db.$queryRaw<unknown[]>`
        SELECT id FROM schedules
        WHERE fleet_id = ${fleetId} AND ship_id = ${shipId} AND state IN ('active'::schedule_state, 'paused'::schedule_state)
        ORDER BY id
        FOR UPDATE`;
      const found = await db.schedule.findMany({ where: { fleetId, id: { in: idRows.parse(rows).map((row) => row.id) } }, orderBy: { id: 'asc' } });
      return found.map(toSchedule);
    },
    page: async (fleetId, { shipId, states, cursor, limit }) => {
      // Newest first through schedules_fleet_id_ship_id_id_idx.
      const rows = await db.schedule.findMany({
        where: { fleetId, shipId, state: { in: [...states] }, ...(cursor === undefined ? {} : { id: { lt: cursor } }) },
        orderBy: { id: 'desc' },
        take: limit + 1,
      });
      return pageOf(rows.map(toSchedule), { limit, cursorOf: (schedule) => schedule.id });
    },
  };
}

/** When a fleet's next schedule attempt is due, through schedules_due_idx. */
export function createPrismaScheduleAttempts(prisma: PrismaClient): ScheduleAttempts {
  return {
    nextAttemptAt: async (fleetId) => {
      const [row] = await prisma.$queryRaw<{ at: Date | null }[]>`
        SELECT min(next_attempt_at) AS at FROM schedules WHERE fleet_id = ${fleetId} AND state = 'active'::schedule_state`;
      return row?.at ?? undefined;
    },
  };
}

/** Notifies inside the transaction: Postgres hands the notice to the servers only once it commits. */
export function createPrismaScheduleNotifier(db: Db): ScheduleNotifier {
  return {
    scheduleDue: async (notice) => {
      await db.$executeRaw`SELECT pg_notify(${SCHEDULE_DUE_CHANNEL}, ${JSON.stringify(notice)})`;
    },
  };
}

const scheduleNoticeSchema = z.object({ fleetId: idSchema('fleet'), scheduleId: idSchema('schedule'), attemptAt: z.coerce.date() });

/** A schedule's notice, as the payload of its NOTIFY carries it. */
export function toScheduleNotice(payload: unknown): ScheduleNotice {
  return scheduleNoticeSchema.parse(payload);
}
