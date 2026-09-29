import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { workHistoryProblems } from './check-work-history.ts';
import { createTemporaryRepository, type TemporaryRepository } from './support/temporary-repository.ts';

let repository: TemporaryRepository;
let base: string;

beforeEach(() => {
  repository = createTemporaryRepository();
  repository.write('docs/work-history/2026-09-28.walking-skeleton.md', '# Walking skeleton\n');
  base = repository.commit('docs: an earlier slice');
});

afterEach(() => {
  repository.dispose();
});

describe('the work-history check', () => {
  it('passes a pull request that adds an entry', () => {
    repository.write('packages/server/src/app.ts', 'export {};\n');
    repository.commit('feat: a change');
    repository.write('docs/work-history/2026-09-29.guardrails.md', '# Guardrails\n');
    const head = repository.commit('docs: work history');

    expect(workHistoryProblems(repository.path, { base, head })).toEqual([]);
  });

  it('refuses a pull request without an entry', () => {
    repository.write('packages/server/src/app.ts', 'export {};\n');
    const head = repository.commit('feat: a change');

    expect(workHistoryProblems(repository.path, { base, head })).toEqual([
      expect.stringContaining('adds no file under docs/work-history/'),
    ]);
  });

  it('does not count an edit to an earlier entry', () => {
    repository.write('docs/work-history/2026-09-28.walking-skeleton.md', '# Walking skeleton, amended\n');
    const head = repository.commit('docs: amend an earlier entry');

    expect(workHistoryProblems(repository.path, { base, head })).toHaveLength(1);
  });

  it('does not count an entry the base branch added after the pull request started', () => {
    repository.git(['switch', '--quiet', '--create', 'slice']);
    repository.write('packages/server/src/app.ts', 'export {};\n');
    const head = repository.commit('feat: a change');
    repository.git(['switch', '--quiet', 'main']);
    repository.write('docs/work-history/2026-09-29.other-slice.md', '# Another slice\n');
    const movedBase = repository.commit('docs: another slice merged meanwhile');

    expect(workHistoryProblems(repository.path, { base: movedBase, head })).toHaveLength(1);
  });
});
