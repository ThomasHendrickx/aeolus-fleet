/** Checks changed Prisma modules have changed plan tests (holding scale, decision 2). */
import { dirname, posix } from 'node:path';

import ts from 'typescript';

import { git, repositoryRoot, type PullRequestRange } from './support/git.ts';
import { runPullRequestCheck } from './support/report.ts';

const PRISMA = 'packages/core/src/adapters/prisma/';
const TESTS = 'packages/core/test/';
const HELPER = 'packages/core/test/support/assert-indexed-plan';

function modulePath(from: string, specifier: string): string {
  return posix.normalize(posix.join(dirname(from), specifier)).replace(/\.(?:js|ts)$/, '');
}

/** A test binds a module to a plan by importing it and calling the imported helper. */
function coveredModules(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  let helper = '';
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = modulePath(path, statement.moduleSpecifier.text);
    const bindings = statement.importClause?.namedBindings;
    if (target === HELPER && bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === 'assertIndexedPlan') helper = element.name.text;
      }
    } else if (target.startsWith(PRISMA)) {
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
  const section = /^## Plans\s*\r?\n([\s\S]*?)(?=^## |\s*$)/m.exec(body)?.[1] ?? '';
  return /^None:\s*\S.+$/m.test(section);
}

export function queryPlanProblems(repository: string, input: { range: PullRequestRange; body: string }): string[] {
  const { range, body } = input;
  const changed = git(repository, ['diff', '--name-only', '--diff-filter=ACMRT', '-z', `${range.base}...${range.head}`]).split('\0').filter(Boolean);
  if (explainsNoQueryChange(body)) return [];
  const tests = changed.filter((path) => path.startsWith(TESTS) && path.endsWith('.integration.test.ts'));
  const covered = new Set(tests.flatMap((path) => coveredModules(path, git(repository, ['show', `${range.head}:${path}`]))));
  return changed
    .filter((path) => path.startsWith(PRISMA) && !path.startsWith(`${PRISMA}generated/`) && path.endsWith('.ts') && !path.endsWith('.test.ts'))
    .filter((path) => !covered.has(path.slice(0, -3)))
    .map((path) => `${path}: add or change a plan test importing this module and calling assertIndexedPlan, or explain a change without a query under ## Plans as None: <reason>`);
}

if (import.meta.main) {
  runPullRequestCheck({ name: 'Fleet query plans', problemsIn: (range) => queryPlanProblems(repositoryRoot, { range, body: process.env.PR_BODY ?? '' }) });
}
