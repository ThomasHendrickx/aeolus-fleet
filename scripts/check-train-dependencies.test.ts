import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { trainDependencyProblems } from './check-train-dependencies.ts';
import { createTemporaryRepository, type TemporaryRepository } from './support/temporary-repository.ts';

let repository: TemporaryRepository;

beforeEach(() => {
  repository = createTemporaryRepository();
});

afterEach(() => {
  repository.dispose();
});

function manifest(fields: Record<string, unknown>): string {
  return `${JSON.stringify({ name: 'aeolus-fleet', private: true, ...fields }, null, 2)}\n`;
}

describe("the check that aeolus-fleet depends on no other train's package (decision 0049)", () => {
  it('passes common, ui, core and console, and packages of no train', () => {
    repository.write('package.json', manifest({ devDependencies: { '@aeolus-fleet/core': '0.0.0', typescript: '~6.0.3' } }));
    repository.write('packages/console/package.json', manifest({ name: '@aeolus-fleet/console', dependencies: { '@aeolus-fleet/common': '0.0.0', '@aeolus-fleet/ui': '0.0.0' } }));
    repository.write('packages/ui/package.json', manifest({ name: '@aeolus-fleet/ui', peerDependencies: { '@aeolus-fleet/common': '0.0.0' } }));
    repository.commit('chore: core, ui and console');

    expect(trainDependencyProblems(repository.path)).toEqual([]);
  });

  it.each(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])('refuses another train in %s, naming the file and the package', (field) => {
    repository.write('package.json', manifest({ [field]: { '@aeolus-fleet/squadrons': '^0.28.0' } }));
    repository.commit('chore: squadrons');

    expect(trainDependencyProblems(repository.path)).toEqual([
      "package.json depends on @aeolus-fleet/squadrons, another train's package: aeolus-fleet depends only on @aeolus-fleet/common, @aeolus-fleet/ui, @aeolus-fleet/core and @aeolus-fleet/console",
    ]);
  });

  it('refuses another train in a package of the workspace', () => {
    repository.write('package.json', manifest({}));
    repository.write('packages/core/package.json', manifest({ name: '@aeolus-fleet/core', devDependencies: { '@aeolus-fleet/trierarch-plugin': '^0.28.0' } }));
    repository.commit('chore: the trierarch plugin');

    expect(trainDependencyProblems(repository.path)).toEqual([expect.stringMatching(/^packages\/core\/package\.json depends on @aeolus-fleet\/trierarch-plugin,/)]);
  });

  it('reads only tracked package.json files', () => {
    repository.write('package.json', manifest({}));
    repository.commit('chore: the root');
    repository.write('node_modules/@aeolus-fleet/squadrons/package.json', manifest({ dependencies: { '@aeolus-fleet/gateway': '0.1.0' } }));

    expect(trainDependencyProblems(repository.path)).toEqual([]);
  });
});

describe('the check that ui depends on no @aeolus-fleet package but common (UI package design UP4)', () => {
  it.each(['@aeolus-fleet/core', '@aeolus-fleet/console'])('refuses %s in ui, naming the file and the package', (name) => {
    repository.write('packages/ui/package.json', manifest({ name: '@aeolus-fleet/ui', devDependencies: { [name]: '0.0.0' } }));
    repository.commit('chore: ui on another package');

    expect(trainDependencyProblems(repository.path)).toEqual([`packages/ui/package.json depends on ${name}: ui depends on no @aeolus-fleet package but common`]);
  });
});
