/**
 * Lint check: aeolus-fleet depends on no other train's package (decision
 * 0049). Every tracked package.json names, of the @aeolus-fleet packages,
 * only common, core and console, core's release train. Squadrons, the
 * trierarch plugin, the trierarch and the gateway are trains of their own:
 * depending on one makes the trains circular.
 *
 * Usage: node scripts/check-train-dependencies.ts
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { repositoryRoot, trackedFiles } from './support/git.ts';
import { report } from './support/report.ts';

/** core's release train: the only @aeolus-fleet packages aeolus-fleet depends on. */
export const OWN_TRAIN = ['@aeolus-fleet/common', '@aeolus-fleet/core', '@aeolus-fleet/console'];

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const SCOPE = '@aeolus-fleet/';

export function trainDependencyProblems(repository: string): string[] {
  return trackedFiles(repository)
    .filter((file) => basename(file) === 'package.json')
    .flatMap((file) => {
      const manifest: unknown = JSON.parse(readFileSync(join(repository, file), 'utf8'));
      return dependenciesOf(manifest)
        .filter((name) => name.startsWith(SCOPE) && !OWN_TRAIN.includes(name))
        .map((name) => `${file} depends on ${name}, another train's package: aeolus-fleet depends only on ${OWN_TRAIN.slice(0, -1).join(', ')} and ${OWN_TRAIN.at(-1) ?? ''}`);
    });
}

/** The names a manifest depends on, in every dependency field. */
function dependenciesOf(manifest: unknown): string[] {
  if (typeof manifest !== 'object' || manifest === null) {
    return [];
  }
  return Object.entries(manifest)
    .filter(([field]) => DEPENDENCY_FIELDS.includes(field))
    .flatMap(([, dependencies]: [string, unknown]) => (typeof dependencies === 'object' && dependencies !== null ? Object.keys(dependencies) : []));
}

if (import.meta.main) {
  report({ name: 'no other train', problems: trainDependencyProblems(repositoryRoot) });
}
