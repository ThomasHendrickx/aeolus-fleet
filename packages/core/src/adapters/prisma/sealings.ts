import { idSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { FleetSealing, KeyAvailability, StoredDataKey } from '../../domain/messaging/fleet-sealing.js';
import type { FleetSealingRepository } from '../../domain/messaging/ports.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';
import { payloadColumnsOf, toMessage } from './rows.js';
import { toSchedule } from './schedules.js';

const sealingRow = z.object({
  sealingState: z.enum(['sealing', 'sealed']),
  companyKey: z.string(),
  keyUnavailableReason: z.enum(['accessDenied', 'disabled', 'notFound', 'unreachable']).nullable(),
  keyAvailabilitySince: z.date(),
});

const dataKeyRow = z.object({
  id: idSchema('dataKey'),
  fleetId: idSchema('fleet'),
  wrappedByCompanyKey: z.instanceof(Uint8Array),
  checkValue: z.instanceof(Uint8Array),
  createdAt: z.date(),
  isCurrent: z.boolean(),
});

function toDataKey(row: unknown): StoredDataKey {
  const parsed = dataKeyRow.parse(row);
  return { ...parsed, wrappedByCompanyKey: new Uint8Array(parsed.wrappedByCompanyKey), checkValue: new Uint8Array(parsed.checkValue) };
}

const DATA_KEY_SELECT = { id: true, fleetId: true, wrappedByCompanyKey: true, checkValue: true, createdAt: true, isCurrent: true } as const;

const SEALING_COLUMNS = Prisma.sql`sealing_state::text AS "sealingState", company_key AS "companyKey",
  key_unavailable_reason AS "keyUnavailableReason", key_availability_since AS "keyAvailabilitySince"`;

async function sealingOf(db: Db, { fleetId, isForUpdate }: { fleetId: FleetId; isForUpdate: boolean }): Promise<FleetSealing | undefined> {
  if (isForUpdate) {
    // The fleet's row whether it is sealed or not: holding it waits for every
    // send that read the fleet's current data key (it holds the row as a key
    // share, see currentDataKeyId), so a payload one stored plain is committed
    // before the caller looks for one.
    await db.$queryRaw`SELECT id FROM fleets WHERE id = ${fleetId} FOR UPDATE`;
  }
  const rows: unknown[] = await db.$queryRaw`SELECT ${SEALING_COLUMNS} FROM fleets WHERE id = ${fleetId} AND sealing_state IS NOT NULL`;
  const [row] = rows;
  if (row === undefined) {
    return undefined;
  }
  const { sealingState, companyKey, keyUnavailableReason, keyAvailabilitySince } = sealingRow.parse(row);
  const keyAvailability: KeyAvailability =
    keyUnavailableReason === null ? { isAvailable: true, since: keyAvailabilitySince } : { isAvailable: false, reason: keyUnavailableReason, since: keyAvailabilitySince };
  return { fleetId, state: sealingState, companyKey, keyAvailability };
}

/** The fleets' sealing columns and their data keys on Postgres (decision 0068). */
export function createPrismaFleetSealingRepository(db: Db): FleetSealingRepository {
  return {
    find: (fleetId) => sealingOf(db, { fleetId, isForUpdate: false }),
    findForUpdate: (fleetId) => sealingOf(db, { fleetId, isForUpdate: true }),
    storesPlainPayload: async (fleetId) => {
      const [message, schedule] = await Promise.all([
        db.message.findFirst({ where: { fleetId, payload: { not: null } }, select: { id: true } }),
        db.schedule.findFirst({ where: { fleetId, payload: { not: null } }, select: { id: true } }),
      ]);
      return message !== null || schedule !== null;
    },
    turnOn: async (sealing, firstKey) => {
      const { keyAvailability } = sealing;
      await db.fleet.update({
        where: { id: sealing.fleetId },
        data: {
          sealingState: sealing.state,
          companyKey: sealing.companyKey,
          keyUnavailableReason: keyAvailability.isAvailable ? null : keyAvailability.reason,
          keyAvailabilitySince: keyAvailability.since,
        },
      });
      await db.dataKey.create({ data: firstKey });
    },
    dataKeyAges: async (fleetId) => {
      const rows = await db.dataKey.findMany({ where: { fleetId }, orderBy: { id: 'asc' }, select: { id: true, createdAt: true, isCurrent: true } });
      return rows.map((row) => ({ ...row, id: idSchema('dataKey').parse(row.id) }));
    },
    currentDataKeyId: async (fleetId) => {
      // The fleet's row held as a key share until the unit of work ends: turning
      // sealing on and the sealing pass's last step hold it for update first,
      // so a send that reads no key here commits its plain payload before they
      // look for one, and one that reads after them gets the key. Sends do not
      // wait for each other: the event sequence's update takes no key lock.
      const [row] = z
        .array(z.object({ id: idSchema('dataKey').nullable() }))
        .parse(
          await db.$queryRaw`
            SELECT data_keys.id FROM fleets
            LEFT JOIN data_keys ON data_keys.fleet_id = fleets.id AND data_keys.is_current
            WHERE fleets.id = ${fleetId}
            FOR KEY SHARE OF fleets`,
        );
      return row?.id ?? undefined;
    },
    changeKeyAvailability: async (fleetId, availability) => {
      const reason = availability.isAvailable ? null : availability.reason;
      // Only a change from available to unavailable or back: of two servers racing it, one updates the row.
      const changed = await db.$executeRaw`
        UPDATE fleets SET key_unavailable_reason = ${reason}, key_availability_since = ${availability.since}
        WHERE id = ${fleetId} AND sealing_state IS NOT NULL AND (key_unavailable_reason IS NULL) <> ${availability.isAvailable}`;
      return changed > 0;
    },
    wrappedDataKeys: async (fleetId, dataKeyIds) => {
      const sealing = await sealingOf(db, { fleetId, isForUpdate: false });
      if (sealing === undefined) {
        return undefined;
      }
      const rows = await db.dataKey.findMany({ where: { fleetId, id: { in: [...dataKeyIds] } }, select: DATA_KEY_SELECT });
      return { companyKey: sealing.companyKey, dataKeys: rows.map(toDataKey) };
    },
    sealingFleetIds: async () => {
      const rows = await db.fleet.findMany({ where: { sealingState: 'sealing' }, select: { id: true }, orderBy: { id: 'asc' } });
      return rows.map((row) => idSchema('fleet').parse(row.id));
    },
    tryLockSealing: async (fleetId) => {
      const [row] = z
        .array(z.object({ locked: z.boolean() }))
        .parse(await db.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${fleetId}), hashtext('sealing')) AS locked`);
      return row?.locked === true;
    },
    plainPayloads: async (fleetId, { after, limit }) => {
      // The oldest plain messages after the cursor, through the (fleet_id,
      // created_at) index, so a batch never reads again the ones sealed before it.
      const messageIds = z.array(z.object({ id: idSchema('message') })).parse(
        await db.$queryRaw`
          SELECT id FROM messages
          WHERE fleet_id = ${fleetId} AND payload IS NOT NULL
            AND (${after?.createdAt ?? null}::timestamptz IS NULL OR (created_at, id) > (${after?.createdAt ?? null}::timestamptz, ${after?.id ?? null}::text))
          ORDER BY created_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED`,
      );
      const scheduleIds = z.array(z.object({ id: idSchema('schedule') })).parse(
        await db.$queryRaw`
          SELECT id FROM schedules
          WHERE fleet_id = ${fleetId} AND payload IS NOT NULL
          ORDER BY id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED`,
      );
      const [messages, schedules] = await Promise.all([
        db.message.findMany({ where: { fleetId, id: { in: messageIds.map((row) => row.id) } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
        db.schedule.findMany({ where: { fleetId, id: { in: scheduleIds.map((row) => row.id) } }, orderBy: { id: 'asc' } }),
      ]);
      return { messages: messages.map(toMessage), schedules: schedules.map(toSchedule) };
    },
    sealPayloads: async (fleetId, sealed) => {
      for (const { id, payload, requestHash } of sealed.messages) {
        await db.message.updateMany({ where: { fleetId, id }, data: { ...payloadColumnsOf(payload), requestHash } });
      }
      for (const { id, payload, requestHash } of sealed.schedules) {
        await db.schedule.updateMany({ where: { fleetId, id }, data: { ...payloadColumnsOf(payload), requestHash } });
      }
    },
    markSealed: async (fleetId) => {
      await db.fleet.updateMany({ where: { id: fleetId, sealingState: 'sealing' }, data: { sealingState: 'sealed' } });
    },
    fleetsDueANewDataKey: async (cutoff) => {
      const rows = await db.dataKey.findMany({ where: { isCurrent: true, createdAt: { lte: cutoff } }, select: { fleetId: true }, orderBy: { fleetId: 'asc' } });
      return rows.map((row) => idSchema('fleet').parse(row.fleetId));
    },
    addCurrentDataKey: async (dataKey) => {
      // The one current before first, so the unique index on the current key holds at every statement.
      await db.dataKey.updateMany({ where: { fleetId: dataKey.fleetId, isCurrent: true }, data: { isCurrent: false } });
      await db.dataKey.create({ data: dataKey });
    },
  };
}
