import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { queryPlanProblems } from './check-query-plans.ts';
import { createTemporaryRepository, type TemporaryRepository } from './support/temporary-repository.ts';

describe('the fleet query plan check', () => {
  let repository: TemporaryRepository;
  beforeEach(() => { repository = createTemporaryRepository(); });
  afterEach(() => { repository.dispose(); });

  it('refuses a new fleet query without its plan test', () => {
    repository.write('packages/core/src/adapters/prisma/schema.prisma', 'model Message {\n fleetId String @map("fleet_id")\n @@map("messages")\n}\n');
    const base = repository.commit('base');
    repository.write('packages/core/src/adapters/prisma/history.ts', 'export const list = (db) => db.message.findMany({ where: { fleetId } });\n');
    const head = repository.commit('query');
    expect(queryPlanProblems(repository.path, { base, head })).toEqual([
      expect.stringMatching(/history\.ts.*message\.findMany.*assertIndexedPlan/),
    ]);
  });
});

it('accepts a named query when its plan test names it and uses the helper', () => {
  const repository = createTemporaryRepository();
  try {
    repository.write('packages/core/src/adapters/prisma/schema.prisma', 'model Message {\n fleetId String @map("fleet_id")\n @@map("messages")\n}\n');
    const base = repository.commit('base');
    repository.write('packages/core/src/adapters/prisma/history.ts', '// plan-query: history.list\nexport const list = (db) => db.message.findMany({ where: { fleetId } });\n');
    repository.write('packages/core/test/history.integration.test.ts', "it('plan: history.list', async () => { await assertIndexedPlan(db, statement); });\n");
    const head = repository.commit('query and plan');
    expect(queryPlanProblems(repository.path, { base, head })).toEqual([]);
  } finally { repository.dispose(); }
});
