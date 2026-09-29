import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { testProjectProblems } from './check-test-projects.ts';
import { createTemporaryRepository, type TemporaryRepository } from './support/temporary-repository.ts';

// A Vitest config with two projects, the way vitest.config.ts declares them.
const config = `export default {
  test: {
    projects: [
      { test: { name: 'server:unit', root: 'packages/server', include: ['src/**/*.test.ts'] } },
      {
        test: {
          name: 'server:integration',
          root: 'packages/server',
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
  repository.write('packages/server/src/core/shared/ping.test.ts', 'test\n');
  repository.write('packages/server/test/api.integration.test.ts', 'test\n');
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
    'packages/server/test/api.test.ts',
    'packages/web/lib/health.test.ts',
    'packages/web/components/atoms/button.test.tsx',
  ])('refuses %s, which no project runs', async (file) => {
    repository.write(file, 'test\n');
    repository.commit('test: stray');

    await expect(testProjectProblems(repository.path)).resolves.toEqual([
      `${file} matches no Vitest project, so it never runs`,
    ]);
  });

  it('looks only at files git tracks', async () => {
    repository.commit('test: covered');
    repository.write('packages/web/lib/scratch.test.ts', 'test\n');

    await expect(testProjectProblems(repository.path)).resolves.toEqual([]);
  });
});
