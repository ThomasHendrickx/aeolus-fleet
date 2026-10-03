import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { RepositoryStore } from './ports.js';
import type { RefreshCatalogue } from './refresh-catalogue.js';

export type RemoveRepository = (input: { fleetId: FleetId; name: string }) => Promise<Result<undefined, DomainError<'REPOSITORY_NOT_FOUND'>>>;

/**
 * Use case: the operator removes a template repository (#161). Its versions
 * leave the catalogue at once, with nothing fetched; formed squadrons keep
 * the versions they formed from.
 */
export function createRemoveRepository(deps: { store: RepositoryStore; refresh: RefreshCatalogue }): RemoveRepository {
  return async ({ fleetId, name }) => {
    if (!(await deps.store.remove(fleetId, name))) {
      return refuse('REPOSITORY_NOT_FOUND', `No repository ${name} is added`);
    }
    await deps.refresh(fleetId, 'none');
    return ok(undefined);
  };
}
