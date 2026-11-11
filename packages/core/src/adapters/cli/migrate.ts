import { loadDatabaseUrl } from '../../config.js';
import type { CommandIo, ExitCode } from './io.js';
import { prepareDatabase } from './prepare-database.js';

/**
 * `aeolus-core migrate`: applies the migrations this package ships, then
 * builds every fleet's rule matches (rule-matches.md Q3, rollout A). Needs
 * DATABASE_URL alone. `start` migrates too; this runs it on its own, such as
 * before a start in a deploy.
 */
export async function migrate(deps: {
  environment: Record<string, string | undefined>;
  migrateDatabase: (databaseUrl: string) => Promise<void>;
  buildRuleMatches: (databaseUrl: string) => Promise<void>;
  io: CommandIo;
}): Promise<ExitCode> {
  await prepareDatabase({ databaseUrl: loadDatabaseUrl(deps.environment), migrateDatabase: deps.migrateDatabase, buildRuleMatches: deps.buildRuleMatches });
  deps.io.out('The database is migrated.');
  return 0;
}
