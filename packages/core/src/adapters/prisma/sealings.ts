import { idSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { StoredDataKey } from '../../domain/messaging/fleet-sealing.js';
import type { FleetSealingRepository } from '../../domain/messaging/ports.js';
import type { Db } from './client.js';

const sealingRow = z.object({ sealingState: z.enum(['sealing', 'sealed']), companyKey: z.string() });

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

async function sealingOf(db: Db, { fleetId, isForUpdate }: { fleetId: FleetId; isForUpdate: boolean }) {
  const rows: unknown[] = isForUpdate
    ? await db.$queryRaw`SELECT sealing_state::text AS "sealingState", company_key AS "companyKey" FROM fleets WHERE id = ${fleetId} AND sealing_state IS NOT NULL FOR UPDATE`
    : await db.$queryRaw`SELECT sealing_state::text AS "sealingState", company_key AS "companyKey" FROM fleets WHERE id = ${fleetId} AND sealing_state IS NOT NULL`;
  const [row] = rows;
  if (row === undefined) {
    return undefined;
  }
  const { sealingState, companyKey } = sealingRow.parse(row);
  return { fleetId, state: sealingState, companyKey };
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
      await db.fleet.update({ where: { id: sealing.fleetId }, data: { sealingState: sealing.state, companyKey: sealing.companyKey } });
      await db.dataKey.create({ data: firstKey });
    },
    currentDataKeyId: async (fleetId) => {
      const row = await db.dataKey.findFirst({ where: { fleetId, isCurrent: true }, select: { id: true } });
      return row === null ? undefined : idSchema('dataKey').parse(row.id);
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
