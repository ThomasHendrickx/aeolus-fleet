import { loadDatabaseUrl } from '../../config.js';
import type { CommandIo, ExitCode } from './io.js';

/**
 * `aeolus-core migrate`: applies the migrations this package ships. Needs
 * DATABASE_URL alone. `start` migrates too; this runs it on its own, such as
 * before a start in a deploy.
 */
export async function migrate(deps: {
  environment: Record<string, string | undefined>;
  migrateDatabase: (databaseUrl: string) => Promise<void>;
  io: CommandIo;
}): Promise<ExitCode> {
  await deps.migrateDatabase(loadDatabaseUrl(deps.environment));
  deps.io.out('The database is migrated.');
  return 0;
}
