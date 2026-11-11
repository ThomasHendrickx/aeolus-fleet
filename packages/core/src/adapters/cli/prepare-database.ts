/**
 * Prepares the database before core serves (rule-matches.md Q3, rollout A):
 * the migrations, then every fleet's rule-match build. A failure of either
 * rejects, so `start` never listens on a database whose matches are unbuilt.
 */
export async function prepareDatabase(deps: {
  databaseUrl: string;
  migrateDatabase: (databaseUrl: string) => Promise<void>;
  buildRuleMatches: (databaseUrl: string) => Promise<void>;
}): Promise<void> {
  await deps.migrateDatabase(deps.databaseUrl);
  await deps.buildRuleMatches(deps.databaseUrl);
}
