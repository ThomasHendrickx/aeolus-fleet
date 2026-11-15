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
    expect(queryPlanProblems(repository.path, { range: { base, head }, body: '' })).toEqual([
      expect.stringMatching(/history\.ts.*plan test.*assertIndexedPlan/),
    ]);
  });

  it('accepts a changed plan test that imports the changed query module and calls the helper', () => {
    const base = repository.commit('base');
    repository.write(module, 'export const list = () => db.message.findMany({});\n');
    repository.write(test, plan);
    const head = repository.commit('query and plan');
    expect(queryPlanProblems(repository.path, { range: { base, head }, body: '' })).toEqual([]);
  });

  it('refuses an unchanged plan test', () => {
    repository.write(module, 'export const list = () => db.message.findMany({});\n');
    repository.write(test, plan);
    const base = repository.commit('base');
    repository.write(module, 'export const list = () => db.message.findMany({ take: 5 });\n');
    const head = repository.commit('change');
    expect(queryPlanProblems(repository.path, { range: { base, head }, body: '' })).toHaveLength(1);
  });

  it('refuses an unrelated plan test', () => {
    const base = repository.commit('base');
    repository.write(module, 'export const list = () => db.message.findMany({});\n');
    repository.write(test, plan.replace('prisma/history.js', 'prisma/other.js'));
    const head = repository.commit('change');
    expect(queryPlanProblems(repository.path, { range: { base, head }, body: '' })).toHaveLength(1);
  });

  it('accepts a Plans section explaining that no query changed', () => {
    const base = repository.commit('base');
    repository.write(module, 'export const list = () => db.message.findMany({});\n');
    const head = repository.commit('refactor');
    expect(queryPlanProblems(repository.path, { range: { base, head }, body: '## Plans\n\nNone: This only renames a local variable.\n' })).toEqual([]);
  });

  it('does not accept an empty Plans reason', () => {
    const base = repository.commit('base');
    repository.write(module, 'export const list = () => db.message.findMany({});\n');
    const head = repository.commit('refactor');
    expect(queryPlanProblems(repository.path, { range: { base, head }, body: '## Plans\n\nNone: \n' })).toHaveLength(1);
  });

  describe('a query module outside the Prisma folder', () => {
    const outside = 'packages/core/src/maintenance-pass.ts';
    const query = 'export const pass = () => db.$queryRaw(Prisma.sql`SELECT * FROM messages`);\n';

    it('refuses a changed module that issues a raw query', () => {
      const base = repository.commit('base');
      repository.write(outside, query);
      const head = repository.commit('query');
      expect(queryPlanProblems(repository.path, { range: { base, head }, body: '' })).toEqual([expect.stringMatching(/maintenance-pass\.ts.*plan test/)]);
    });

    it('refuses a query module moved out of the folder while its query changes', () => {
      repository.write(module, 'export const list = () => db.$queryRaw`SELECT 1`;\n');
      const base = repository.commit('base');
      repository.remove(module);
      repository.write('packages/core/src/history.ts', 'export const list = () => db.$queryRaw`SELECT 2`;\n');
      const head = repository.commit('move');
      expect(queryPlanProblems(repository.path, { range: { base, head }, body: '' }).join('\n')).toMatch(/src\/history\.ts/);
    });

    it('refuses a change that only removes a query fragment from a module', () => {
      repository.write('packages/core/src/fragments.ts', 'export const where = Prisma.sql`fleet_id = ${id}`;\nexport const other = 1;\n');
      const base = repository.commit('base');
      repository.write('packages/core/src/fragments.ts', 'export const other = 1;\n');
      const head = repository.commit('drop fragment');
      expect(queryPlanProblems(repository.path, { range: { base, head }, body: '' }).join('\n')).toMatch(/fragments\.ts/);
    });

    it('refuses a changed fragment module', () => {
      const base = repository.commit('base');
      repository.write('packages/core/src/fragments.ts', 'export const where = Prisma.raw("fleet_id = 1");\n');
      const head = repository.commit('fragment');
      expect(queryPlanProblems(repository.path, { range: { base, head }, body: '' }).join('\n')).toMatch(/fragments\.ts/);
    });

    it('refuses a changed .mts query module inside the folder', () => {
      const base = repository.commit('base');
      repository.write('packages/core/src/adapters/prisma/history.mts', 'export const list = () => db.message.findMany({});\n');
      const head = repository.commit('query');
      expect(queryPlanProblems(repository.path, { range: { base, head }, body: '' }).join('\n')).toMatch(/history\.mts/);
    });

    it('accepts a changed module with no query', () => {
      const base = repository.commit('base');
      repository.write(outside, 'export const pass = () => 1;\n');
      const head = repository.commit('plain');
      expect(queryPlanProblems(repository.path, { range: { base, head }, body: '' })).toEqual([]);
    });

    it('accepts a changed module covered by a plan test importing it', () => {
      const base = repository.commit('base');
      repository.write(outside, query);
      repository.write(test, plan.replace('../src/adapters/prisma/history.js', '../src/maintenance-pass.js'));
      const head = repository.commit('query and plan');
      expect(queryPlanProblems(repository.path, { range: { base, head }, body: '' })).toEqual([]);
    });
  });

  it('does not count a type-only import as coverage', () => {
    const base = repository.commit('base');
    repository.write(module, 'export const list = () => db.message.findMany({});\n');
    repository.write(test, plan.replace('import { list }', 'import type { list }'));
    const head = repository.commit('change');
    expect(queryPlanProblems(repository.path, { range: { base, head }, body: '' })).toHaveLength(1);
  });

  it.each([
    ['two spaces after the marks', '##  Plans\n\nNone: This only renames a local variable.\n'],
    ['a lowercase none', '## Plans\n\nnone: This only renames a local variable.\n'],
    ['a full stop', '## Plans\n\nNone. This only renames a local variable.\n'],
    ['a one-character reason', '## Plans\n\nNone: x\n'],
  ])('reads Plans like the Walk section: accepts %s', (_label, body) => {
    const base = repository.commit('base');
    repository.write(module, 'export const list = () => db.message.findMany({});\n');
    const head = repository.commit('refactor');
    expect(queryPlanProblems(repository.path, { range: { base, head }, body })).toEqual([]);
  });
});
