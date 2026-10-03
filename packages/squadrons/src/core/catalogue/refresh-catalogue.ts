import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { assembleCatalogue } from './assemble-catalogue.js';
import type { CatalogueHolder, RepositoryReader, RepositoryStore } from './ports.js';

/** Which repositories a refresh fetches: every one, one by name, or none. */
export type RefreshScope = 'all' | 'none' | { name: string };

export type RefreshCatalogue = (fleetId: FleetId, scope: RefreshScope) => Promise<void>;

/**
 * Use case: squadrons builds the catalogue it serves from the fleet's
 * template repositories (#161). It fetches the repositories the scope names,
 * and records when each was fetched and why one could not be; every other
 * repository is read from what it last fetched. Nothing fetches by itself: a
 * fetch happens when the operator adds a repository or refreshes.
 */
export function createRefreshCatalogue(deps: { store: RepositoryStore; source: RepositoryReader; holder: CatalogueHolder; clock: Clock }): RefreshCatalogue {
  return async (fleetId, scope) => {
    const repositories = await deps.store.list(fleetId);
    const isFetched = (name: string): boolean => scope === 'all' || (typeof scope === 'object' && scope.name === name);
    const { files, fetched } = await deps.source.read(repositories, { fetch: isFetched });
    const at = deps.clock.now();
    for (const { name, error } of fetched) {
      await deps.store.recordFetch(fleetId, { name, at, error });
    }
    deps.holder.set(assembleCatalogue(files));
  };
}
