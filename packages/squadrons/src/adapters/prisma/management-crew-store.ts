import { idSchema } from '@aeolus-fleet/common';

import type { ManagementCrewStore } from '../../core/management/ports.js';
import type { Db } from './client.js';

/** The one row's key: squadrons crews one management ship. */
const SINGLETON = 'management';

export function createPrismaManagementCrewStore(db: Db): ManagementCrewStore {
  return {
    find: async () => {
      const row = await db.managementCrew.findUnique({ where: { key: SINGLETON } });
      return row ? { shipId: idSchema('ship').parse(row.shipId), crewToken: row.crewToken, crewedAt: row.crewedAt } : undefined;
    },
    save: async ({ shipId, crewToken, crewedAt }) => {
      await db.managementCrew.upsert({
        where: { key: SINGLETON },
        create: { key: SINGLETON, shipId, crewToken, crewedAt },
        update: { shipId, crewToken, crewedAt },
      });
    },
  };
}
