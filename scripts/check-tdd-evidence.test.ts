import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isProductionFile, isTestFile, readCommits, tddViolations } from './check-tdd-evidence.ts';
import { createTemporaryRepository, type TemporaryRepository } from './support/temporary-repository.ts';

let repository: TemporaryRepository;
let base: string;

beforeEach(() => {
  repository = createTemporaryRepository();
  repository.write('packages/server/src/core/registry/fleet.ts', 'export const fleet = 1;\n');
  repository.write('packages/server/src/core/registry/fleet.test.ts', 'test 1\n');
  base = repository.commit('feat(registry): fleet');
});

afterEach(() => {
  repository.dispose();
});

function violations(head: string, exemptUpTo?: string): string[] {
  return tddViolations(readCommits(repository.path, { range: { base, head }, exemptUpTo }));
}

function red(subject = 'test(registry): fleet name rule (red)'): string {
  repository.write('packages/server/src/core/registry/fleet.test.ts', `test ${subject}\n`);
  return repository.commit(subject);
}

function green(subject = 'feat(registry): fleet name rule'): string {
  repository.write('packages/server/src/core/registry/fleet.ts', `export const fleet = '${subject}';\n`);
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
      `${head.slice(0, 12)} "feat(registry): untested" changes production code (packages/server/src/core/registry/fleet.ts), but the commit before it is not a (red) commit that only adds or changes tests`,
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

  it('passes a refactor(...) commit directly after a green commit, without a (red) commit', () => {
    red();
    green('feat(registry): the rule');
    const head = green('refactor(registry): tidy the rule');

    expect(violations(head)).toEqual([]);
  });

  it('refuses a refactor(...) commit that does not come directly after a green commit', () => {
    red();
    green('feat(registry): the rule');
    repository.write('docs/notes.md', 'notes\n');
    repository.commit('docs: notes');
    const head = green('refactor(registry): tidy the rule');

    expect(violations(head)).toEqual([expect.stringContaining('"refactor(registry): tidy the rule"')]);
  });

  it('refuses a second refactor(...) commit after one green commit', () => {
    red();
    green('feat(registry): the rule');
    green('refactor(registry): tidy the rule');
    const head = green('refactor(registry): tidy it again');

    expect(violations(head)).toEqual([expect.stringContaining('"refactor(registry): tidy it again"')]);
  });

  it('refuses a refactor(...) commit after production code that had no (red) commit', () => {
    const untested = green('feat(registry): untested');
    const head = green('refactor(registry): tidy the rule');

    expect(violations(head)).toEqual([
      expect.stringContaining(`${untested.slice(0, 12)} "feat(registry): untested"`),
      expect.stringContaining('"refactor(registry): tidy the rule"'),
    ]);
  });

  it('takes only a subject starting with refactor(...) as a refactor', () => {
    red();
    green('feat(registry): the rule');
    const head = green('chore(registry): refactor(registry) the rule');

    expect(violations(head)).toHaveLength(1);
  });

  it('refuses a (red) commit that also changes production code', () => {
    repository.write('packages/server/src/core/registry/fleet.test.ts', 'test red\n');
    repository.write('packages/server/src/core/registry/ship.ts', 'export const ship = 1;\n');
    repository.commit('test(registry): fleet name rule (red)');
    const head = green();

    expect(violations(head)).toHaveLength(2);
  });

  it('refuses a (red) commit that changes anything but tests', () => {
    repository.write('packages/server/src/core/registry/fleet.test.ts', 'test red\n');
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
    repository.remove('packages/server/src/core/registry/fleet.test.ts');
    repository.commit('test(registry): drop a test (red)');
    const head = green();

    expect(violations(head)).toHaveLength(1);
  });

  it('refuses a commit that only deletes production code without a (red) commit', () => {
    repository.remove('packages/server/src/core/registry/fleet.ts');
    const head = repository.commit('refactor(registry): remove fleet');

    expect(violations(head)).toHaveLength(1);
  });

  it('takes test support in a test folder and end-to-end tests as tests', () => {
    repository.write('packages/server/test/support/in-memory.ts', 'fake\n');
    repository.write('e2e/console-sign-in.e2e.test.ts', 'test\n');
    repository.commit('test(identity): sign-in fake (red)');
    const head = green();

    expect(violations(head)).toEqual([]);
  });

  it('passes a commit that changes only comments in production code, without a (red) commit', () => {
    repository.write(
      'packages/server/src/core/registry/fleet.ts',
      '/** The fleet: one operator\'s ships. */\nexport const fleet = 1; // one fleet in v1\n',
    );
    const head = repository.commit('docs(registry): say what the fleet is');

    expect(violations(head)).toEqual([]);
  });

  it('passes a comment-only change in the Prisma schema', () => {
    repository.write('packages/server/src/adapters/prisma/schema.prisma', 'model Fleet {\n  id String @id\n}\n');
    base = repository.commit('feat(prisma): fleets');
    repository.write(
      'packages/server/src/adapters/prisma/schema.prisma',
      '/// The tenant.\nmodel Fleet {\n  id String @id // flt_\n}\n',
    );
    const head = repository.commit('docs(prisma): say what a fleet is');

    expect(violations(head)).toEqual([]);
  });

  it('refuses a commit that changes a comment and code together', () => {
    repository.write('packages/server/src/core/registry/fleet.ts', '/** Two fleets now. */\nexport const fleet = 2;\n');
    const head = repository.commit('docs(registry): a comment, and more');

    expect(violations(head)).toEqual([expect.stringContaining('"docs(registry): a comment, and more"')]);
  });

  it('refuses a change inside a string that looks like a comment', () => {
    repository.write('packages/server/src/core/registry/fleet.ts', "export const fleet = '// not a comment';\n");
    base = repository.commit('feat(registry): fleet as text');
    repository.write('packages/server/src/core/registry/fleet.ts', "export const fleet = '// still not one';\n");
    const head = repository.commit('docs(registry): reword');

    expect(violations(head)).toHaveLength(1);
  });

  it('judges a new production file as code, even one holding only comments', () => {
    repository.write('packages/server/src/core/registry/ship.ts', '// Ships arrive later.\n');
    const head = repository.commit('docs(registry): a placeholder');

    expect(violations(head)).toHaveLength(1);
  });

  it('judges a comment-only change to a migration as code: it reads only TypeScript and Prisma', () => {
    const migration = 'packages/server/src/adapters/prisma/migrations/1_init/migration.sql';
    repository.write(migration, 'CREATE TABLE fleets (id TEXT);\n');
    base = repository.commit('feat(prisma): the first migration');
    repository.write(migration, '-- The tenants.\nCREATE TABLE fleets (id TEXT);\n');
    const head = repository.commit('docs(prisma): comment the migration');

    expect(violations(head)).toHaveLength(1);
  });

  it('judges common/src like server/src', () => {
    repository.write('packages/common/src/ids/index.ts', 'export const id = 1;\n');
    const head = repository.commit('feat(common): ids');

    expect(violations(head)).toHaveLength(1);
  });

  it('does not judge tests, docs, scripts, web or Markdown in src', () => {
    repository.write('packages/server/src/core/registry/fleet.test.ts', 'test only\n');
    repository.commit('test(registry): more cases');
    repository.write('packages/server/src/core/registry/README.md', '# Registry\n');
    repository.write('packages/web/app/page.tsx', 'page\n');
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
    repository.write('packages/server/src/core/registry/ship.ts', 'export const ship = 1;\n');
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
    repository.git(['mv', 'packages/server/src/core/registry/fleet.test.ts', 'packages/server/src/core/registry/fleet-name.test.ts']);
    repository.commit('test(registry): rename the test (red)');
    repository.git(['mv', 'packages/server/src/core/registry/fleet.ts', 'packages/server/src/core/registry/fleet-name.ts']);
    const head = repository.commit('refactor(registry): rename the module');

    const commits = readCommits(repository.path, { range: { base, head } });
    expect(commits.map((commit) => commit.files)).toEqual([
      [
        {
          status: 'R100',
          previousPath: 'packages/server/src/core/registry/fleet.test.ts',
          path: 'packages/server/src/core/registry/fleet-name.test.ts',
        },
      ],
      [
        {
          status: 'R100',
          previousPath: 'packages/server/src/core/registry/fleet.ts',
          path: 'packages/server/src/core/registry/fleet-name.ts',
        },
      ],
    ]);
    expect(tddViolations(commits)).toEqual([]);
  });
});

describe('what counts as a test and as production code', () => {
  it.each([
    'packages/server/src/core/registry/fleet.test.ts',
    'packages/web/components/atoms/button.test.tsx',
    'packages/server/test/support/in-memory.ts',
    'packages/server/test/api.integration.test.ts',
    'e2e/support/web.ts',
  ])('%s is a test file', (path) => {
    expect(isTestFile(path)).toBe(true);
    expect(isProductionFile(path)).toBe(false);
  });

  it.each([
    'packages/server/src/core/registry/fleet.ts',
    'packages/server/src/adapters/prisma/schema.prisma',
    'packages/server/src/adapters/prisma/migrations/20260929124818_init/migration.sql',
    'packages/common/src/ids/index.ts',
  ])('%s is production code', (path) => {
    expect(isProductionFile(path)).toBe(true);
  });

  it.each(['packages/server/src/core/registry/README.md', 'packages/web/app/page.tsx', 'scripts/set-version.ts', 'packages/server/prisma.config.ts'])(
    '%s is not judged',
    (path) => {
      expect(isProductionFile(path)).toBe(false);
    },
  );
});
