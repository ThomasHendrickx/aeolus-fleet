import { idSchema, scopeNameSchema } from '@aeolus-fleet/common';

import type { DefinedScopeRepository } from '../../domain/registry/ports.js';
import type { DefinedScope } from '../../domain/registry/defined-scope.js';
import type { Db } from './client.js';

/** A defined scope row as the domain trusts it. */
function definedOf(row: { fleetId: string; scope: string; description: string }): DefinedScope {
  return { fleetId: idSchema('fleet').parse(row.fleetId), scope: scopeNameSchema.parse(row.scope), description: row.description };
}

/** The fleet's own scopes on Postgres (design gateway-scopes, 4.1). */
export function createPrismaDefinedScopeRepository(db: Db): DefinedScopeRepository {
  return {
    find: async (fleetId, scope) => {
      const row = await db.definedScope.findUnique({ where: { fleetId_scope: { fleetId, scope } } });
      return row === null ? undefined : definedOf(row);
    },
    save: async ({ fleetId, scope, description }) => {
      await db.definedScope.upsert({ where: { fleetId_scope: { fleetId, scope } }, create: { fleetId, scope, description }, update: { description } });
    },
    remove: async (fleetId, scope) => {
      await db.definedScope.deleteMany({ where: { fleetId, scope } });
    },
  };
}
