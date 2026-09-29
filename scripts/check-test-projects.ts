/**
 * CI check: Vitest runs every test file. Each *.test.ts or *.test.tsx that git
 * tracks must match a project in vitest.config.ts, so no test is written and
 * then never run. Vitest itself decides what a project matches.
 *
 * Usage: node scripts/check-test-projects.ts
 */
import { join } from 'node:path';

import { createVitest } from 'vitest/node';

import { repositoryRoot, trackedFiles } from './support/git.ts';
import { report } from './support/report.ts';

const TEST_FILE = /\.test\.tsx?$/;

export async function testProjectProblems(repository: string): Promise<string[]> {
  const vitest = await createVitest({ root: repository, watch: false });
  try {
    return trackedFiles(repository)
      .filter((file) => TEST_FILE.test(file))
      .filter((file) => !vitest.projects.some((project) => project.matchesTestGlob(join(repository, file))))
      .map((file) => `${file} matches no Vitest project, so it never runs`);
  } finally {
    await vitest.close();
  }
}

if (import.meta.main) {
  report({ name: 'Every test runs', problems: await testProjectProblems(repositoryRoot) });
}
