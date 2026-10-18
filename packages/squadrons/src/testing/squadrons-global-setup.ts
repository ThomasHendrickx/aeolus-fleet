import type { TestProject } from 'vitest/node';

// Types only: vitest loads a global setup outside the test environment, where a workspace package resolves to its unbuilt dist.
import type {} from '@aeolus-fleet/core/testing/postgres-global-setup';

import { createPrismaClient } from '../adapters/prisma/client.js';
import { migrateDatabase } from '../adapters/prisma/migrate.js';

/** The database this setup migrates once; every squadrons database a test asks for is a copy of it. */
export const SQUADRONS_TEMPLATE = 'aeolus_test_squadrons_template';

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
  const templateUrl = new URL(adminUrl);
  templateUrl.pathname = `/${SQUADRONS_TEMPLATE}`;
  await migrateDatabase(templateUrl.toString());
}
