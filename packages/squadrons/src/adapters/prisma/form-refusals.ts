import { idSchema } from '@aeolus-fleet/common';

import type { FormRefusals } from '../../core/squadron/ports.js';
import type { Db } from './client.js';

export function createPrismaFormRefusals(db: Db, clock: { now(): Date }): FormRefusals {
  return {
    find: async (fleetId, { formingShipId, key }) => {
      const row = await db.formRefusal.findUnique({ where: { fleetId_formingShipId_key: { fleetId, formingShipId, key } } });
      return row === null ? undefined : { formingShipId: idSchema('ship').parse(row.formingShipId), key: row.key, code: row.code, message: row.message };
    },
    keep: async ({ fleetId, formingShipId, key, code, message }) => {
      // The first refusal of a key is its answer: keeping one again changes nothing.
      await db.formRefusal.upsert({
        where: { fleetId_formingShipId_key: { fleetId, formingShipId, key } },
        create: { fleetId, formingShipId, key, code, message, refusedAt: clock.now() },
        update: {},
      });
    },
  };
}
