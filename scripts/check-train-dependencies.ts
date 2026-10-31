/**
 * Lint check: aeolus-fleet depends on no other train's package (decision
 * 0049). Every tracked package.json names, of the @aeolus-fleet packages,
 * only common, ui, core and console, core's release train. Squadrons, the
 * trierarch plugin, the trierarch and the gateway are trains of their own:
 * depending on one makes the trains circular. And ui depends on no
 * @aeolus-fleet package but common (UI package design UP4): it knows no app.
 *
 * Usage: node scripts/check-train-dependencies.ts
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { repositoryRoot, trackedFiles } from './support/git.ts';
import { report } from './support/report.ts';

/** core's release train: the only @aeolus-fleet packages aeolus-fleet depends on. */
export const OWN_TRAIN = ['@aeolus-fleet/common', '@aeolus-fleet/ui', '@aeolus-fleet/core', '@aeolus-fleet/console'];

/** The one @aeolus-fleet package ui may name, for its types. */
const UI_MANIFEST = 'packages/ui/package.json';
const UI_MAY_DEPEND_ON = '@aeolus-fleet/common';

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const SCOPE = '@aeolus-fleet/';

export function trainDependencyProblems(repository: string): string[] {
  return trackedFiles(repository)
    .filter((file) => basename(file) === 'package.json')
    .flatMap((file) => {
      const manifest: unknown = JSON.parse(readFileSync(join(repository, file), 'utf8'));
      const ownPackages = dependenciesOf(manifest).filter((name) => name.startsWith(SCOPE));
      const otherTrains = ownPackages
        .filter((name) => !OWN_TRAIN.includes(name))
        .map((name) => `${file} depends on ${name}, another train's package: aeolus-fleet depends only on ${OWN_TRAIN.slice(0, -1).join(', ')} and ${OWN_TRAIN.at(-1) ?? ''}`);
      const uiOnMoreThanCommon =
        file === UI_MANIFEST
          ? ownPackages.filter((name) => OWN_TRAIN.includes(name) && name !== UI_MAY_DEPEND_ON).map((name) => `${file} depends on ${name}: ui depends on no @aeolus-fleet package but common`)
          : [];
      return [...otherTrains, ...uiOnMoreThanCommon];
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
