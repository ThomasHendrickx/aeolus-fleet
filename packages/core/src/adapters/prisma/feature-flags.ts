import { featureFlagSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { FeatureFlagRepository } from '../../domain/registry/ports.js';
import type { Db } from './client.js';

const flagRow = z.object({ flag: featureFlagSchema });

/**
 * A fleet's feature flags (decision 0069): a row per flag that is on. A flag
 * a later release no longer names is skipped on reading, as no row would be.
 */
export function createPrismaFeatureFlagRepository(db: Db): FeatureFlagRepository {
  return {
    onFor: async (fleetId: FleetId) => {
      const rows = await db.fleetFeatureFlag.findMany({ where: { fleetId }, select: { flag: true }, orderBy: { flag: 'asc' } });
      return rows.flatMap((row) => {
        const parsed = flagRow.safeParse(row);
        return parsed.success ? [parsed.data.flag] : [];
      });
    },
    isOnForUpdate: async (fleetId, flag) => {
      const rows = await db.$queryRaw<unknown[]>`SELECT 1 FROM fleet_feature_flags WHERE fleet_id = ${fleetId} AND flag = ${flag} FOR UPDATE`;
      return rows.length > 0;
    },
    turnOn: async (fleetId, flag) => {
      await db.$executeRaw`INSERT INTO fleet_feature_flags (fleet_id, flag, created_at) VALUES (${fleetId}, ${flag}, now()) ON CONFLICT DO NOTHING`;
    },
    turnOff: async (fleetId, flag) => {
      await db.fleetFeatureFlag.deleteMany({ where: { fleetId, flag } });
    },
  };
}
