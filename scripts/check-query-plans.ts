/** Checks changed Prisma modules have changed plan tests (holding scale, decision 2). */
import { dirname, posix } from 'node:path';

import ts from 'typescript';

import { git, repositoryRoot, type PullRequestRange } from './support/git.ts';
import { runPullRequestCheck } from './support/report.ts';
import { isNoWalk, walkSection } from './support/walk.ts';

const SOURCE = 'packages/core/src/';
const PRISMA = `${SOURCE}adapters/prisma/`;
const QUERY = /\$queryRaw|\$executeRaw|Prisma\.sql|Prisma\.raw|\b(?:db|prisma|tx|client)\.[a-z]\w*\.(?:find\w+|create\w*|update\w*|upsert|delete\w*|count|aggregate|groupBy)\b/;
const TESTS = 'packages/core/test/';
const HELPER = 'packages/core/test/support/assert-indexed-plan';

function modulePath(from: string, specifier: string): string {
  return posix.normalize(posix.join(dirname(from), specifier)).replace(/\.(?:js|ts|mjs|mts)$/, '');
}

/** A test binds a module to a plan by importing it and calling the imported helper. */
function coveredModules(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  let helper = '';
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    const target = modulePath(path, statement.moduleSpecifier.text);
    const bindings = statement.importClause?.namedBindings;
    if (target === HELPER && bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === 'assertIndexedPlan') helper = element.name.text;
      }
    } else if (target.startsWith(SOURCE)) {
      imports.push(target);
    }
  }
  function hasHelperCall(node: ts.Node): boolean {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === helper && helper !== '') return true;
    return node.getChildren(file).some(hasHelperCall);
  }
  return hasHelperCall(file) ? imports : [];
}

function explainsNoQueryChange(body: string): boolean {
  const section = walkSection(body, 'Plans');
  return section !== undefined && isNoWalk(section);
}

function show(repository: string, revision: string): string {
  try {
    return git(repository, ['show', revision]);
  } catch {
    return '';
  }
}

/** A module under core's src that is not a test or generated code. */
function isSourceModule(path: string): boolean {
  return path.startsWith(SOURCE) && !path.startsWith(`${PRISMA}generated/`) && /\.m?ts$/.test(path) && !/\.test\.m?ts$/.test(path);
}

export function queryPlanProblems(repository: string, input: { range: PullRequestRange; body: string }): string[] {
  const { range, body } = input;
  const changed = git(repository, ['diff', '--name-only', '--no-renames', '--diff-filter=ACMRTD', '-z', `${range.base}...${range.head}`]).split('\0').filter(Boolean);
  if (explainsNoQueryChange(body)) return [];
  const tests = changed.filter((path) => path.startsWith(TESTS) && path.endsWith('.integration.test.ts'));
  const covered = new Set(tests.flatMap((path) => coveredModules(path, show(repository, `${range.head}:${path}`))));
  const mergeBase = git(repository, ['merge-base', range.base, range.head]).trim();
  const issuesQueries = (path: string) =>
    path.startsWith(PRISMA) || QUERY.test(show(repository, `${mergeBase}:${path}`)) || QUERY.test(show(repository, `${range.head}:${path}`));
  return changed
    .filter((path) => isSourceModule(path) && issuesQueries(path))
    .filter((path) => !covered.has(path.replace(/\.m?ts$/, '')))
    .map((path) => `${path}: add or change a plan test importing this module and calling assertIndexedPlan, or explain a change without a query under ## Plans as None: <reason>`);
}

if (import.meta.main) {
  runPullRequestCheck({ name: 'Fleet query plans', problemsIn: (range) => queryPlanProblems(repositoryRoot, { range, body: process.env.PR_BODY ?? '' }) });
}
