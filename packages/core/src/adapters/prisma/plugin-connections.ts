import { idSchema } from '@aeolus-fleet/common';

import type { PluginConnection } from '../../domain/registry/plugin-connection.js';
import type { PluginConnectionRepository } from '../../domain/registry/ports.js';
import type { Db } from './client.js';

function connectionOf(row: { fleetId: string; shipId: string; connectedAt: Date }): PluginConnection {
  return { fleetId: idSchema('fleet').parse(row.fleetId), shipId: idSchema('ship').parse(row.shipId), connectedAt: row.connectedAt };
}

/** The plugins argo connected, on Postgres (decision 0034). */
export function createPrismaPluginConnectionRepository(db: Db): PluginConnectionRepository {
  return {
    find: async (fleetId, shipId) => {
      const row = await db.pluginConnection.findUnique({ where: { fleetId_shipId: { fleetId, shipId } } });
      return row === null ? undefined : connectionOf(row);
    },
    connect: async ({ fleetId, shipId, connectedAt }) => {
      await db.pluginConnection.create({ data: { fleetId, shipId, connectedAt } });
    },
    disconnect: async (fleetId, shipId) => {
      await db.pluginConnection.deleteMany({ where: { fleetId, shipId } });
    },
  };
}
