import { networkRuleSchema, registerNetworkPluginInputSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { FleetNetworks } from '../../core/network/ports.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

const rulesSchema = z.array(networkRuleSchema).nullable();

/** Each fleet's network as argo last saved it, one row per fleet. */
export function createPrismaFleetNetworks(db: Db): FleetNetworks {
  return {
    find: async (fleetId) => {
      const row = await db.fleetNetwork.findUnique({ where: { fleetId } });
      return row
        ? {
            rules: rulesSchema.parse(row.rules),
            declaration: registerNetworkPluginInputSchema.parse({ whileUnavailable: row.whileUnavailable, notRespondingAfterSeconds: row.notRespondingAfterSeconds }),
          }
        : undefined;
    },
    save: async (fleetId, { rules, declaration }) => {
      // None is all-to-all, kept as SQL NULL; an empty list stays a list.
      const columns = { rules: rules === null ? Prisma.DbNull : rules.map((rule) => ({ from: [...rule.from], to: [...rule.to] })), ...declaration };
      await db.fleetNetwork.upsert({ where: { fleetId }, create: { fleetId, ...columns }, update: columns });
    },
  };
}
