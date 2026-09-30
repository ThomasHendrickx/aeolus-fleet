/**
 * CI check: test-driven development leaves evidence in the history (ADR 0014).
 * In a pull request, every commit that changes production code in
 * packages/server/src or packages/common/src comes right after a (red) commit:
 * one whose subject ends in "(red)" and that only adds or changes test files.
 * The one exception is a refactor: a commit whose subject starts with
 * "refactor(...)" directly after a green commit, the production commit that
 * made a (red) commit pass. A refactor does not change behaviour, so it needs
 * no new failing test (test-driven-development skill).
 *
 * A change to comments alone is not a change to production code: a modified
 * TypeScript, JavaScript or Prisma file whose code, printed without comments,
 * stays the same (layout the printer evens out included). A new, deleted or
 * renamed file, and a change to any other kind of file, always counts.
 *
 * Production code is every file under those folders except tests and
 * Markdown. A test file is a *.test.ts(x) file, or any file in a test/ or e2e/
 * folder. Merge commits are not judged. Commits up to the one slice 1b started
 * from are exempt.
 *
 * Usage: node scripts/check-tdd-evidence.ts <base commit> <head commit>
 */
import { codeWithoutComments } from './support/comments.ts';
import { git, repositoryRoot, type PullRequestRange } from './support/git.ts';
import { runPullRequestCheck } from './support/report.ts';

/** The last commit on main before slice 1b introduced this check. It and every commit before it are exempt. */
export const EXEMPT_UP_TO = '18905388af14b21cc57daf1935203bbb84e0f2b7';

const PRODUCTION_FOLDERS = ['packages/server/src/', 'packages/common/src/'];
const TEST_FILE = /\.test\.tsx?$|(^|\/)(test|e2e)\//;
const REFACTOR_SUBJECT = /^refactor\([^)]+\): /;
const RECORD_SEPARATOR = '\u001e';
const UNIT_SEPARATOR = '\u001f';

export interface ChangedFile {
  /** Git's status letter: A added, M modified, D deleted, R renamed (with a similarity score). */
  status: string;
  path: string;
  /** The path before a rename. */
  previousPath?: string;
  /** Set when a modified file changed only in its comments: its code stayed the same. */
  isCommentOnly?: true;
}

export interface Commit {
  hash: string;
  parents: string[];
  subject: string;
  files: ChangedFile[];
}

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
}

export function isProductionFile(path: string): boolean {
  return PRODUCTION_FOLDERS.some((folder) => path.startsWith(folder)) && !isTestFile(path) && !path.endsWith('.md');
}

function touchesProduction(commit: Commit): boolean {
  return commit.files.some(
    (file) =>
      file.isCommentOnly === undefined &&
      (isProductionFile(file.path) || (file.previousPath !== undefined && isProductionFile(file.previousPath))),
  );
}

/** A commit that only adds or changes tests, labelled `(red)`: the failing test before the code. */
export function isRedCommit(commit: Commit): boolean {
  const hasOnlyAddedOrChangedTests = commit.files.every(
    (file) =>
      isTestFile(file.path) &&
      (file.status === 'A' ||
        file.status === 'M' ||
        (file.status.startsWith('R') && file.previousPath !== undefined && isTestFile(file.previousPath))),
  );
  return (
    commit.subject.trimEnd().endsWith('(red)') &&
    commit.parents.length === 1 &&
    commit.files.length > 0 &&
    hasOnlyAddedOrChangedTests
  );
}

/** Judges a pull request's commits, oldest first. */
export function tddViolations(commits: readonly Commit[]): string[] {
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const parentOf = (commit: Commit) => byHash.get(commit.parents[0] ?? '');
  /** Production code right after a (red) commit: the code that made the failing test pass. */
  const isGreenCommit = (commit: Commit) => {
    const parent = parentOf(commit);
    return commit.parents.length === 1 && touchesProduction(commit) && parent !== undefined && isRedCommit(parent);
  };

  return commits
    .filter((commit) => commit.parents.length === 1 && touchesProduction(commit))
    .flatMap((commit) => {
      const parent = parentOf(commit);
      if (parent && (isRedCommit(parent) || (REFACTOR_SUBJECT.test(commit.subject) && isGreenCommit(parent)))) {
        return [];
      }
      const production = commit.files
        .filter((file) => file.isCommentOnly === undefined)
        .map((file) => file.path)
        .filter(isProductionFile)
        .join(', ');
      return [
        `${commit.hash.slice(0, 12)} "${commit.subject}" changes production code (${production}), but the commit before it is not a (red) commit that only adds or changes tests`,
      ];
    });
}

/**
 * The pull request's commits, oldest first, with the files each changes.
 * Leaves out `exemptUpTo` and everything before it, when the repository has it.
 */
export function readCommits(
  repository: string,
  options: { range: PullRequestRange; exemptUpTo?: string },
): Commit[] {
  const { range, exemptUpTo } = options;
  const exempt = exemptUpTo !== undefined && hasCommit(repository, exemptUpTo) ? [`^${exemptUpTo}`] : [];
  const log = git(repository, [
    '-c',
    'core.quotePath=off',
    'log',
    '--reverse',
    '--topo-order',
    '--find-renames',
    '--name-status',
    `--format=${RECORD_SEPARATOR}%H${UNIT_SEPARATOR}%P${UNIT_SEPARATOR}%s`,
    `${range.base}..${range.head}`,
    ...exempt,
  ]);

  return log
    .split(RECORD_SEPARATOR)
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [header = '', ...lines] = record.split('\n');
      const [hash = '', parents = '', subject = ''] = header.split(UNIT_SEPARATOR);
      const parentList = parents.split(' ').filter(Boolean);
      const files = lines.filter((line) => line.trim() !== '').map(changedFile);
      return {
        hash,
        parents: parentList,
        subject,
        files: files.map((file) =>
          isCommentOnlyChange(repository, { file, commit: hash, parent: parentList[0] })
            ? { ...file, isCommentOnly: true }
            : file,
        ),
      };
    });
}

/**
 * True when a modified production file's code, printed without comments, is
 * the same before and after the commit. Only modified files are compared: a
 * new, deleted or renamed file is always a change to code.
 */
function isCommentOnlyChange(
  repository: string,
  change: { file: ChangedFile; commit: string; parent: string | undefined },
): boolean {
  const { file, commit, parent } = change;
  if (file.status !== 'M' || parent === undefined || !isProductionFile(file.path)) {
    return false;
  }
  const before = codeWithoutComments(file.path, git(repository, ['show', `${parent}:${file.path}`]));
  const after = codeWithoutComments(file.path, git(repository, ['show', `${commit}:${file.path}`]));
  return before !== undefined && before === after;
}

function changedFile(line: string): ChangedFile {
  const [status = '', first = '', second] = line.split('\t');
  return second === undefined ? { status, path: first } : { status, path: second, previousPath: first };
}

function hasCommit(repository: string, hash: string): boolean {
  try {
    git(repository, ['cat-file', '-e', `${hash}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  runPullRequestCheck({
    name: 'TDD evidence',
    problemsIn: (range) => tddViolations(readCommits(repositoryRoot, { range, exemptUpTo: EXEMPT_UP_TO })),
  });
}
