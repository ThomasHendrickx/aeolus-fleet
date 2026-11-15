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
