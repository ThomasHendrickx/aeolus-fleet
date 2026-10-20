import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isProductionFile, isTestFile, readCommits, tddViolations } from './check-tdd-evidence.ts';
import { createTemporaryRepository, type TemporaryRepository } from './support/temporary-repository.ts';

let repository: TemporaryRepository;
let base: string;

beforeEach(() => {
  repository = createTemporaryRepository();
  repository.write('packages/core/src/domain/registry/fleet.ts', 'export const fleet = 1;\n');
  repository.write('packages/core/src/domain/registry/fleet.test.ts', 'test 1\n');
  base = repository.commit('feat(registry): fleet');
});

afterEach(() => {
  repository.dispose();
});

function violations(head: string, exemptUpTo?: string): string[] {
  return tddViolations(readCommits(repository.path, { range: { base, head }, exemptUpTo }));
}

function red(subject = 'test(registry): fleet name rule (red)'): string {
  repository.write('packages/core/src/domain/registry/fleet.test.ts', `test ${subject}\n`);
  return repository.commit(subject);
}

function green(subject = 'feat(registry): fleet name rule'): string {
  repository.write('packages/core/src/domain/registry/fleet.ts', `export const fleet = '${subject}';\n`);
  return repository.commit(subject);
}

describe('the TDD evidence check', () => {
  it('passes a (red) commit followed by the code that makes it pass', () => {
    red();
    const head = green();

    expect(violations(head)).toEqual([]);
  });

  it('passes several red and green pairs', () => {
    red('test(registry): first rule (red)');
    green('feat(registry): first rule');
    red('test(registry): second rule (red)');
    const head = green('feat(registry): second rule');

    expect(violations(head)).toEqual([]);
  });

  it('refuses production code without a (red) commit before it, naming commit and files', () => {
    const head = green('feat(registry): untested');

    expect(violations(head)).toEqual([
      `${head.slice(0, 12)} "feat(registry): untested" changes production code (packages/core/src/domain/registry/fleet.ts), but the commit before it is not a (red) commit that only adds or changes tests`,
    ]);
  });

  it('refuses when the (red) commit is not directly before the code', () => {
    red();
    repository.write('docs/notes.md', 'notes\n');
    repository.commit('docs: notes');
    const head = green();

    expect(violations(head)).toHaveLength(1);
  });

  it('refuses a second production commit after one (red) commit', () => {
    red();
    green('feat(registry): the rule');
    const head = green('feat(registry): another rule');

    expect(violations(head)).toEqual([expect.stringContaining('"feat(registry): another rule"')]);
  });

  it('refuses the code after a (red) commit that also changes production code', () => {
    repository.write('packages/core/src/domain/registry/fleet.test.ts', 'test red\n');
    repository.write('packages/core/src/domain/registry/ship.ts', 'export const ship = 1;\n');
    repository.commit('test(registry): fleet name rule (red)');
    const head = green();

    expect(violations(head)).toEqual([expect.stringContaining('"feat(registry): fleet name rule"')]);
  });

  it('refuses a (red) commit that changes anything but tests', () => {
    repository.write('packages/core/src/domain/registry/fleet.test.ts', 'test red\n');
    repository.write('docs/notes.md', 'notes\n');
    repository.commit('test(registry): fleet name rule (red)');
    const head = green();

    expect(violations(head)).toHaveLength(1);
  });

  it('refuses a test commit whose subject does not end in (red)', () => {
    red('test(registry): fleet name rule');
    const head = green();

    expect(violations(head)).toHaveLength(1);
  });

  it('refuses a (red) commit that deletes a test', () => {
    repository.remove('packages/core/src/domain/registry/fleet.test.ts');
    repository.commit('test(registry): drop a test (red)');
    const head = green();

    expect(violations(head)).toHaveLength(1);
  });

  it('refuses a fix commit without a (red) commit before it', () => {
    const head = green('fix(registry): the fleet name');

    expect(violations(head)).toEqual([expect.stringContaining('"fix(registry): the fleet name"')]);
  });

  it('passes a fix commit directly after a (red) commit', () => {
    red();
    const head = green('fix(registry): the fleet name');

    expect(violations(head)).toEqual([]);
  });

  it.each(['feat: fleet name', 'feat(registry)!: fleet name', 'fix!: fleet name'])(
    'judges %j as a feat or fix commit, with or without a scope or a breaking mark',
    (subject) => {
      const head = green(subject);

      expect(violations(head)).toHaveLength(1);
    },
  );

  it('refuses a feat commit that only deletes production code without a (red) commit', () => {
    repository.remove('packages/core/src/domain/registry/fleet.ts');
    const head = repository.commit('feat(registry): remove fleet');

    expect(violations(head)).toHaveLength(1);
  });

  it.each([
    'refactor(registry): tidy the rule',
    'docs(registry): say what the fleet is',
    'chore(registry): bump',
    'style(registry): format',
    'perf(registry): faster',
    'test(registry): more cases',
    'build: the package',
    'ci: the check',
    'revert: the rule',
  ])('passes %j, which is neither feat nor fix, wherever it comes', (subject) => {
    const head = green(subject);

    expect(violations(head)).toEqual([]);
  });

  it('takes only the type at the start of the subject: feat or fix elsewhere in it does not count', () => {
    const head = green('chore(registry): feat(registry) and fix the rule');

    expect(violations(head)).toEqual([]);
  });

  it('takes test support in a test folder and end-to-end tests as tests', () => {
    repository.write('packages/core/test/support/in-memory.ts', 'fake\n');
    repository.write('e2e/console-sign-in.e2e.test.ts', 'test\n');
    repository.commit('test(identity): sign-in fake (red)');
    const head = green();

    expect(violations(head)).toEqual([]);
  });

  it('judges common/src like server/src', () => {
    repository.write('packages/common/src/ids/index.ts', 'export const id = 1;\n');
    const head = repository.commit('feat(common): ids');

    expect(violations(head)).toHaveLength(1);
  });

  it('does not judge tests, docs, scripts, web or Markdown in src', () => {
    repository.write('packages/core/src/domain/registry/fleet.test.ts', 'test only\n');
    repository.commit('test(registry): more cases');
    repository.write('packages/core/src/domain/registry/README.md', '# Registry\n');
    repository.write('packages/console/app/page.tsx', 'page\n');
    repository.write('scripts/set-version.ts', 'script\n');
    repository.write('docs/blueprint.md', 'blueprint\n');
    const head = repository.commit('docs: many things');

    expect(violations(head)).toEqual([]);
  });

  it('judges only the pull request, not its base', () => {
    const head = repository.commit('chore: nothing');

    expect(violations(head)).toEqual([]);
  });

  it('does not judge merge commits, and a merge is no (red) commit', () => {
    repository.git(['switch', '--quiet', '--create', 'slice']);
    red();
    green();
    repository.git(['switch', '--quiet', 'main']);
    repository.write('packages/core/src/domain/registry/ship.ts', 'export const ship = 1;\n');
    const movedBase = repository.commit('feat(registry): ship, merged on main meanwhile');
    repository.git(['switch', '--quiet', 'slice']);
    repository.git(['merge', '--quiet', '--no-edit', 'main']);
    const afterMerge = green('feat(registry): after the merge');
    // CI passes the base branch as it is now, so what the merge brought in is not the pull request's.
    base = movedBase;

    expect(violations(afterMerge)).toEqual([expect.stringContaining('"feat(registry): after the merge"')]);
  });

  it('exempts commits up to the given commit', () => {
    const untested = green('feat(registry): before the check existed');
    red();
    const head = green();

    expect(violations(head)).toHaveLength(1);
    expect(violations(head, untested)).toEqual([]);
  });

  it('reads renames with their previous path', () => {
    repository.git(['mv', 'packages/core/src/domain/registry/fleet.test.ts', 'packages/core/src/domain/registry/fleet-name.test.ts']);
    repository.commit('test(registry): rename the test (red)');
    repository.git(['mv', 'packages/core/src/domain/registry/fleet.ts', 'packages/core/src/domain/registry/fleet-name.ts']);
    const head = repository.commit('refactor(registry): rename the module');

    const commits = readCommits(repository.path, { range: { base, head } });
    expect(commits.map((commit) => commit.files)).toEqual([
      [
        {
          status: 'R100',
          previousPath: 'packages/core/src/domain/registry/fleet.test.ts',
          path: 'packages/core/src/domain/registry/fleet-name.test.ts',
        },
      ],
      [
        {
          status: 'R100',
          previousPath: 'packages/core/src/domain/registry/fleet.ts',
          path: 'packages/core/src/domain/registry/fleet-name.ts',
        },
      ],
    ]);
    expect(tddViolations(commits)).toEqual([]);
  });
});

describe('what counts as a test and as production code', () => {
  it.each([
    'packages/core/src/domain/registry/fleet.test.ts',
    'packages/console/components/atoms/button.test.tsx',
    'packages/core/test/support/in-memory.ts',
    'packages/core/test/api.integration.test.ts',
    'e2e/support/web.ts',
  ])('%s is a test file', (path) => {
    expect(isTestFile(path)).toBe(true);
    expect(isProductionFile(path)).toBe(false);
  });

  it.each([
    'packages/core/src/domain/registry/fleet.ts',
    'packages/core/src/adapters/prisma/schema.prisma',
    'packages/core/src/adapters/prisma/migrations/20260929124818_init/migration.sql',
    'packages/common/src/ids/index.ts',
  ])('%s is production code', (path) => {
    expect(isProductionFile(path)).toBe(true);
  });

  it.each(['packages/core/src/domain/registry/README.md', 'packages/console/app/page.tsx', 'scripts/set-version.ts', 'packages/core/prisma.config.ts'])(
    '%s is not judged',
    (path) => {
      expect(isProductionFile(path)).toBe(false);
    },
  );
});
