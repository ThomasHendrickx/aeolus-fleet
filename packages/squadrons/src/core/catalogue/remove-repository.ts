import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { RepositoryReader, RepositoryStore } from './ports.js';
import type { RefreshCatalogue } from './refresh-catalogue.js';

export type RemoveRepository = (input: { fleetId: FleetId; name: string }) => Promise<Result<undefined, DomainError<'REPOSITORY_NOT_FOUND'>>>;

/**
 * Use case: the operator removes a template repository (#161). What was
 * fetched of it is deleted, so the same repository added again serves only
 * what it fetches itself, and its versions leave the catalogue at once, with
 * nothing fetched; formed squadrons keep the versions they formed from.
 */
export function createRemoveRepository(deps: { store: RepositoryStore; source: RepositoryReader; refresh: RefreshCatalogue }): RemoveRepository {
  return async ({ fleetId, name }) => {
    const repository = (await deps.store.list(fleetId)).find((each) => each.name === name);
    if (!repository || !(await deps.store.remove(fleetId, name))) {
      return refuse('REPOSITORY_NOT_FOUND', `No repository ${name} is added`);
    }
    await deps.source.forget(repository);
    await deps.refresh(fleetId, 'none');
    return ok(undefined);
  };
}
