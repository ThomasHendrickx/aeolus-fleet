import { idSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { FleetSealing, KeyAvailability, StoredDataKey } from '../../domain/messaging/fleet-sealing.js';
import type { FleetSealingRepository } from '../../domain/messaging/ports.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

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
  const rows: unknown[] = isForUpdate
    ? await db.$queryRaw`SELECT ${SEALING_COLUMNS} FROM fleets WHERE id = ${fleetId} AND sealing_state IS NOT NULL FOR UPDATE`
    : await db.$queryRaw`SELECT ${SEALING_COLUMNS} FROM fleets WHERE id = ${fleetId} AND sealing_state IS NOT NULL`;
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
        db.schedule.findFirst({ where: { fleetId }, select: { id: true } }),
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
    currentDataKeyId: async (fleetId) => {
      const row = await db.dataKey.findFirst({ where: { fleetId, isCurrent: true }, select: { id: true } });
      return row === null ? undefined : idSchema('dataKey').parse(row.id);
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
  };
}
