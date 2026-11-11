import { describe, expect, it } from 'vitest';

import { prepareDatabase } from './prepare-database.js';

describe('preparing the database before core serves (rule-matches.md Q3, rollout A)', () => {
  it('migrates, then builds the rule matches, in that order', async () => {
    // Given a migration and a build that record when they run.
    const steps: string[] = [];

    // When the database is prepared.
    await prepareDatabase({ databaseUrl: 'postgres://prepared', migrateDatabase: (url) => { steps.push(`migrate ${url}`); return Promise.resolve(); }, buildRuleMatches: (url) => { steps.push(`build ${url}`); return Promise.resolve(); } });

    // Then the build ran after the migration, on the same database.
    expect(steps).toEqual(['migrate postgres://prepared', 'build postgres://prepared']);
  });

  it('fails, so core never starts serving, when the build fails', async () => {
    // Given a build that fails.
    const failing = () => Promise.reject(new Error('build failed'));

    // When the database is prepared.
    const prepared = prepareDatabase({ databaseUrl: 'postgres://prepared', migrateDatabase: () => Promise.resolve(), buildRuleMatches: failing });

    // Then the preparation fails with the build's error.
    await expect(prepared).rejects.toThrow('build failed');
  });
});
