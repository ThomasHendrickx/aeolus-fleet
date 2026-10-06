import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { testProjectProblems } from './check-test-projects.ts';
import { createTemporaryRepository, type TemporaryRepository } from './support/temporary-repository.ts';

// A Vitest config with two projects, the way vitest.config.ts declares them.
const config = `export default {
  test: {
    projects: [
      { test: { name: 'core:unit', root: 'packages/core', include: ['src/**/*.test.ts'] } },
      {
        test: {
          name: 'core:integration',
          root: 'packages/core',
          include: ['test/**/*.integration.test.ts'],
        },
      },
    ],
  },
};
`;

let repository: TemporaryRepository;

beforeEach(() => {
  repository = createTemporaryRepository();
  repository.write('vitest.config.js', config);
  repository.write('packages/core/src/domain/shared/ping.test.ts', 'test\n');
  repository.write('packages/core/test/api.integration.test.ts', 'test\n');
});

afterEach(() => {
  repository.dispose();
});

describe('the test project check', () => {
  it('passes when every test file matches a project', async () => {
    repository.commit('test: covered');

    await expect(testProjectProblems(repository.path)).resolves.toEqual([]);
  });

  it.each([
    'packages/core/test/api.test.ts',
    'packages/console/lib/health.test.ts',
    'packages/console/components/atoms/button.test.tsx',
  ])('refuses %s, which no project runs', async (file) => {
    repository.write(file, 'test\n');
    repository.commit('test: stray');

    await expect(testProjectProblems(repository.path)).resolves.toEqual([
      `${file} matches no Vitest project, so it never runs`,
    ]);
  });

  it('looks only at files git tracks', async () => {
    repository.commit('test: covered');
    repository.write('packages/console/lib/scratch.test.ts', 'test\n');

    await expect(testProjectProblems(repository.path)).resolves.toEqual([]);
  });

  it('matches the same files when the repository is reached through a symbolic link, as the temporary folder is on macOS', async () => {
    repository.commit('test: covered');
    const links = mkdtempSync(join(tmpdir(), 'aeolus-link-'));
    const link = join(links, 'repository');
    symlinkSync(repository.path, link);
    try {
      await expect(testProjectProblems(link)).resolves.toEqual([]);
    } finally {
      rmSync(links, { recursive: true, force: true });
    }
  });
});
