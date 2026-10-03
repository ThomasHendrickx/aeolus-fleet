import type { FleetId } from '@aeolus-fleet/common';

import type { RepositoryStore } from './ports.js';
import { listedRepositoryOf, type ListedRepository } from './template-repository.js';

export type ListRepositories = (fleetId: FleetId) => Promise<ListedRepository[]>;

/** Use case: the operator lists the fleet's template repositories, each with whether it has a token, never the token. */
export function createListRepositories(deps: { store: RepositoryStore }): ListRepositories {
  return async (fleetId) => (await deps.store.list(fleetId)).map(listedRepositoryOf);
}
