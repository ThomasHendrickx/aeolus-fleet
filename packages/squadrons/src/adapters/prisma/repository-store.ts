import { idSchema } from '@aeolus-fleet/common';

import type { RepositoryStore } from '../../core/catalogue/ports.js';
import type { Db } from './client.js';

/** Postgres' code for a unique violation: the fleet has a repository of that name already. */
const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION;
}

export function createPrismaRepositoryStore(db: Db): RepositoryStore {
  return {
    list: async (fleetId) =>
      (await db.templateRepository.findMany({ where: { fleetId }, orderBy: [{ addedAt: 'asc' }, { name: 'asc' }] })).map((row) => ({
        fleetId: idSchema('fleet').parse(row.fleetId),
        name: row.name,
        url: row.url,
        path: row.path,
        token: row.token,
        addedAt: row.addedAt,
        lastFetch: row.lastFetchedAt === null ? null : { at: row.lastFetchedAt, error: row.lastFetchError },
      })),
    add: async ({ fleetId, name, url, path, token, addedAt, lastFetch }) => {
      try {
        await db.templateRepository.create({
          data: { fleetId, name, url, path, token, addedAt, lastFetchedAt: lastFetch?.at ?? null, lastFetchError: lastFetch?.error ?? null },
        });
        return 'added';
      } catch (error) {
        if (isUniqueViolation(error)) {
          return 'taken';
        }
        throw error;
      }
    },
    remove: async (fleetId, name) => (await db.templateRepository.deleteMany({ where: { fleetId, name } })).count > 0,
    recordFetch: async (fleetId, { name, at, error }) => {
      await db.templateRepository.updateMany({ where: { fleetId, name }, data: { lastFetchedAt: at, lastFetchError: error } });
    },
  };
}
