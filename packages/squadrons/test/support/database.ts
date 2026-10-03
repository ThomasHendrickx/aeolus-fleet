import { migrateDatabase } from '../../src/adapters/prisma/migrate.js';
// The shared Postgres container's URL, which the global setup provides to every file.
import type {} from '../../../server/test/postgres.global-setup.js';
import { createEmptyDatabase } from '../../../server/test/support/database.js';

/** A database of its own in the shared Postgres container, with squadrons' migrations applied. */
export async function createSquadronsDatabase(): Promise<string> {
  const databaseUrl = await createEmptyDatabase();
  await migrateDatabase(databaseUrl);
  return databaseUrl;
}
