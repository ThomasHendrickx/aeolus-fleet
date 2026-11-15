import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { queryPlanProblems } from './check-query-plans.ts';
import { createTemporaryRepository, type TemporaryRepository } from './support/temporary-repository.ts';

describe('the fleet query plan check', () => {
  let repository: TemporaryRepository;
  const module = 'packages/core/src/adapters/prisma/history.ts';
  const test = 'packages/core/test/history.integration.test.ts';
  const plan = "import { list } from '../src/adapters/prisma/history.js';\nimport { assertIndexedPlan } from './support/assert-indexed-plan.js';\nit('plans history', async () => { await assertIndexedPlan(db, list()); });\n";

  beforeEach(() => { repository = createTemporaryRepository(); });
  afterEach(() => { repository.dispose(); });

  it.each([
    ['a Prisma query', 'db.message.findMany({ where: { fleetId } })'],
    ['a raw query', 'db.$queryRaw`SELECT * FROM messages`'],
    ['a composed statement', 'Prisma.sql`SELECT * FROM messages`'],
  ])('refuses %s without a changed plan test', (_label, query) => {
    const base = repository.commit('base');
    repository.write(module, `export const list = () => ${query};\n`);
    const head = repository.commit('query');
    expect(queryPlanProblems(repository.path, { base, head }, '')).toEqual([
      expect.stringMatching(/history\.ts.*plan test.*assertIndexedPlan/),
    ]);
  });

  it('accepts a changed plan test that imports the changed query module and calls the helper', () => {
    const base = repository.commit('base');
    repository.write(module, 'export const list = () => db.message.findMany({});\n');
    repository.write(test, plan);
    const head = repository.commit('query and plan');
    expect(queryPlanProblems(repository.path, { base, head }, '')).toEqual([]);
  });

  it('refuses an unchanged plan test', () => {
    repository.write(module, 'export const list = () => db.message.findMany({});\n');
    repository.write(test, plan);
    const base = repository.commit('base');
    repository.write(module, 'export const list = () => db.message.findMany({ take: 5 });\n');
    const head = repository.commit('change');
    expect(queryPlanProblems(repository.path, { base, head }, '')).toHaveLength(1);
  });

  it('refuses an unrelated plan test', () => {
    const base = repository.commit('base');
    repository.write(module, 'export const list = () => db.message.findMany({});\n');
    repository.write(test, plan.replace('prisma/history.js', 'prisma/other.js'));
    const head = repository.commit('change');
    expect(queryPlanProblems(repository.path, { base, head }, '')).toHaveLength(1);
  });

  it('accepts a Plans section explaining that no query changed', () => {
    const base = repository.commit('base');
    repository.write(module, 'export const list = () => db.message.findMany({});\n');
    const head = repository.commit('refactor');
    expect(queryPlanProblems(repository.path, { base, head }, '## Plans\n\nNone: This only renames a local variable.\n')).toEqual([]);
  });

  it('does not accept an empty Plans reason', () => {
    const base = repository.commit('base');
    repository.write(module, 'export const list = () => db.message.findMany({});\n');
    const head = repository.commit('refactor');
    expect(queryPlanProblems(repository.path, { base, head }, '## Plans\n\nNone: \n')).toHaveLength(1);
  });
});
