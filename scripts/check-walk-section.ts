/**
 * CI check: a pull request that changes what a person sees (a console page, or the API a ship calls) has a Walk section
 * in its body (the pull-request skill), or says `None: <reason>` under `## Walk`. The Walk's API steps are replayed by
 * replay-walk-section.test.ts.
 *
 * Usage: PR_BODY=<the pull request body> node scripts/check-walk-section.ts <base commit> <head commit>
 */
import { git, repositoryRoot, type PullRequestRange } from './support/git.ts';
import { runPullRequestCheck } from './support/report.ts';
import { walkSection } from './support/walk.ts';

const SEEN_BY_A_PERSON = [
  /^packages\/console\/app\/.+\.tsx?$/,
  /^packages\/console\/features\/[^/]+\/ui\/.+\.tsx$/,
  /^packages\/core\/src\/adapters\/(?:trpc|rest|mcp)\/.+\.ts$/,
];
const TEST_FILE = /\.(?:test|stories)\.tsx?$/;

export function filesSeenByAPerson(files: readonly string[]): string[] {
  return files.filter((file) => SEEN_BY_A_PERSON.some((pattern) => pattern.test(file)) && !TEST_FILE.test(file));
}

export function walkProblems(change: { files: readonly string[]; body: string }): string[] {
  const seen = filesSeenByAPerson(change.files);
  if (seen.length === 0 || walkSection(change.body) !== undefined) {
    return [];
  }
  return [
    `The pull request changes what a person sees (${seen.slice(0, 3).join(', ')}${seen.length > 3 ? ', ...' : ''}) but its body has no ## Walk section. ` +
      'Add one, or write "None: <reason>" under ## Walk when nobody can see the change.',
  ];
}

function changedFiles(repository: string, range: PullRequestRange): string[] {
  return git(repository, ['diff', '--name-only', '--diff-filter=ACMR', '-z', `${range.base}...${range.head}`]).split('\0').filter(Boolean);
}

if (import.meta.main) {
  runPullRequestCheck({
    name: 'Walk section',
    problemsIn: (range) => walkProblems({ files: changedFiles(repositoryRoot, range), body: process.env.PR_BODY ?? '' }),
  });
}
