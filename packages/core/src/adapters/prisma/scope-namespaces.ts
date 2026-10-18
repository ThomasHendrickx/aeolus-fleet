import { declaredScopeSchema, idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { ScopeNamespaceRepository } from '../../domain/registry/ports.js';
import type { ScopeNamespace } from '../../domain/registry/scope-namespace.js';
import type { Db } from './client.js';

/** A namespace row as the domain trusts it: its scopes parsed from their JSON. */
function namespaceOf(row: { fleetId: string; namespace: string; declaredBy: string; scopes: unknown }): ScopeNamespace {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    namespace: row.namespace,
    declaredBy: idSchema('ship').parse(row.declaredBy),
    scopes: z.array(declaredScopeSchema).parse(row.scopes),
  };
}

/** The plugin namespaces on Postgres (decision 0046). */
export function createPrismaScopeNamespaceRepository(db: Db): ScopeNamespaceRepository {
  return {
    lockNamespace: async (fleetId, namespace) => {
      // As for a label key: a transaction-level advisory lock on the fleet and
      // the namespace, so a second declaration, or a grant of its scopes,
      // waits and then finds it as the first one left it.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fleetId}), hashtext(${`scope-namespace:${namespace}`}))`;
    },
    find: async (fleetId, namespace) => {
      const row = await db.scopeNamespace.findUnique({ where: { fleetId_namespace: { fleetId, namespace } } });
      return row === null ? undefined : namespaceOf(row);
    },
    findByDeclarer: async (fleetId, shipId) => {
      const row = await db.scopeNamespace.findUnique({ where: { fleetId_declaredBy: { fleetId, declaredBy: shipId } } });
      return row === null ? undefined : namespaceOf(row);
    },
    list: async (fleetId) => (await db.scopeNamespace.findMany({ where: { fleetId }, orderBy: { namespace: 'asc' } })).map(namespaceOf),
    save: async ({ fleetId, namespace, declaredBy, scopes }) => {
      const kept = { scopes: scopes.map(({ scope, description }) => ({ scope, description })) };
      await db.scopeNamespace.upsert({ where: { fleetId_namespace: { fleetId, namespace } }, create: { fleetId, namespace, declaredBy, ...kept }, update: kept });
    },
    remove: async (fleetId, namespace) => {
      await db.scopeNamespace.deleteMany({ where: { fleetId, namespace } });
    },
  };
}
