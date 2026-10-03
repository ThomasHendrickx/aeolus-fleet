import { idSchema } from '@aeolus-fleet/common';

import type { ManagementCrewStore } from '../../core/management/ports.js';
import type { Db } from './client.js';

/** The one row's key: squadrons crews one management ship. */
const SINGLETON = 'management';

export function createPrismaManagementCrewStore(db: Db): ManagementCrewStore {
  return {
    find: async () => {
      const row = await db.managementCrew.findUnique({ where: { key: SINGLETON } });
      return row?.crewToken
        ? {
            fleetId: idSchema('fleet').parse(row.fleetId),
            shipId: idSchema('ship').parse(row.shipId),
            name: row.shipName,
            crewToken: row.crewToken,
            crewedAt: row.crewedAt,
          }
        : undefined;
    },
    binding: async () => {
      const row = await db.managementCrew.findUnique({ where: { key: SINGLETON } });
      return row ? { fleetId: idSchema('fleet').parse(row.fleetId), shipId: idSchema('ship').parse(row.shipId) } : undefined;
    },
    save: async ({ fleetId, shipId, name, crewToken, crewedAt }) => {
      const columns = { fleetId, shipId, shipName: name, crewToken, crewedAt };
      await db.managementCrew.upsert({ where: { key: SINGLETON }, create: { key: SINGLETON, ...columns }, update: columns });
    },
    drop: async () => {
      await db.managementCrew.updateMany({ where: { key: SINGLETON }, data: { crewToken: null } });
    },
  };
}
