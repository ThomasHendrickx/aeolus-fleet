import type { TestProject } from 'vitest/node';

import { createPrismaClient } from '../../core/src/adapters/prisma/client.js';
// The shared Postgres container's URL, which core's global setup provides before this one runs.
import type {} from '../../core/test/postgres.global-setup.js';
import { databaseUrlOf } from '../../core/test/support/migrated-template.js';
import { migrateDatabase } from '../src/adapters/prisma/migrate.js';
import { SQUADRONS_TEMPLATE } from './support/database.js';

/**
 * Migrates squadrons' template once, before any test runs; every squadrons
 * database a test asks for is a copy of it. Migrating each test's database
 * itself started a Prisma CLI per test, and Prisma Migrate gives up with
 * P1001 when Postgres takes over 5 seconds to answer it, as it can under a
 * full run's load (#654).
 */
export async function setup(project: TestProject): Promise<void> {
  const adminUrl = project.getProvidedContext().postgresUrl;
  const admin = createPrismaClient(adminUrl);
  try {
    // The name is a constant, never outside input.
    await admin.$executeRawUnsafe(`CREATE DATABASE ${SQUADRONS_TEMPLATE}`);
  } finally {
    await admin.$disconnect();
  }
  await migrateDatabase(databaseUrlOf(adminUrl, SQUADRONS_TEMPLATE));
}
