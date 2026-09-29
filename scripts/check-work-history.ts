/**
 * CI check: a pull request adds a work-history entry under docs/work-history/
 * (CLAUDE.md, "Working").
 *
 * Usage: node scripts/check-work-history.ts <base commit> <head commit>
 */
import { git, repositoryRoot, type PullRequestRange } from './support/git.ts';
import { runPullRequestCheck } from './support/report.ts';

export const WORK_HISTORY_FOLDER = 'docs/work-history/';

export function workHistoryProblems(repository: string, range: PullRequestRange): string[] {
  const added = git(repository, [
    'diff',
    '--name-only',
    '--diff-filter=A',
    '-z',
    `${range.base}...${range.head}`,
    '--',
    WORK_HISTORY_FOLDER,
  ])
    .split('\0')
    .filter(Boolean);

  return added.length > 0
    ? []
    : [`The pull request adds no file under ${WORK_HISTORY_FOLDER}. Add docs/work-history/YYYY-MM-DD.<slice-name>.md.`];
}

if (import.meta.main) {
  runPullRequestCheck({ name: 'Work history', problemsIn: (range) => workHistoryProblems(repositoryRoot, range) });
}
