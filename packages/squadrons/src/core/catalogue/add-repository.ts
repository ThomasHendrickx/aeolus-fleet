import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { RepositoryStore } from './ports.js';
import type { RefreshCatalogue } from './refresh-catalogue.js';
import { listedRepositoryOf, parseRepositoryInput, type ListedRepository } from './template-repository.js';

export type AddRepositoryRefusal = DomainError<'INVALID_REPOSITORY' | 'REPOSITORY_TAKEN'>;

export type AddRepository = (input: { fleetId: FleetId; url: string; path?: string; token?: string }) => Promise<Result<ListedRepository, AddRepositoryRefusal>>;

/**
 * Use case: the operator adds a template repository in the console (#161):
 * its https URL, an optional path and an optional read token, which is never
 * shown again. It is stored first and fetched at once; a repository whose
 * first fetch fails is kept, with why, so the operator sees it.
 */
export function createAddRepository(deps: { store: RepositoryStore; refresh: RefreshCatalogue; clock: Clock }): AddRepository {
  return async ({ fleetId, ...input }) => {
    const parsed = parseRepositoryInput(input);
    if (!parsed.isOk) {
      return parsed;
    }
    const { name } = parsed.value;
    if ((await deps.store.add({ fleetId, ...parsed.value, addedAt: deps.clock.now(), lastFetch: null })) === 'taken') {
      return refuse('REPOSITORY_TAKEN', `${name} is added already: remove it first to add it again`);
    }
    await deps.refresh(fleetId, { name });
    const added = (await deps.store.list(fleetId)).find((each) => each.name === name);
    return added ? ok(listedRepositoryOf(added)) : refuse('REPOSITORY_TAKEN', `${name} was removed while it was added`);
  };
}
