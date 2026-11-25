import type { GuardConfiguration } from '../../../lib/trierarch-plugin-guard-schemas';

export type RuleSetRepository = Omit<GuardConfiguration['repositories'][number], 'readCommit'>;

export type GuardChange =
  | { kind: 'add'; repository: RuleSetRepository; readToken: string }
  | { kind: 'remove'; repository: string }
  | { kind: 'floor'; name: string; isIncluded: boolean };

export type RepositoryUpdate =
  | { state: 'pending' | 'success' }
  | { state: 'failure'; reason: string; hasStoredCopy: boolean };

export interface GuardSaveError {
  message: string;
  shouldReadAgain?: boolean;
}

/** Build the versioned replacement and retain each remaining private token by its repository name. */
export function guardReplacement(configuration: GuardConfiguration, change: GuardChange) {
  const repositories = configuration.repositories.map(({ repository, folder, access }) => ({ repository, folder, access }));
  const floor = configuration.floor.filter((name) => change.kind !== 'floor' || name !== change.name);

  if (change.kind === 'add') repositories.push(change.repository);
  if (change.kind === 'floor' && change.isIncluded) floor.push(change.name);

  const retained = change.kind === 'remove' ? repositories.filter(({ repository }) => repository !== change.repository) : repositories;
  return {
    expectedVersion: configuration.version,
    repositories: retained,
    floor,
    secrets: retained.filter(({ access }) => access === 'private').map(({ repository }) => repository),
    secretValues: change.kind === 'add' && change.repository.access === 'private'
      ? { [change.repository.repository]: change.readToken }
      : {},
  };
}
