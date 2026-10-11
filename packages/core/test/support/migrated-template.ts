import { createPrismaClient } from '../../src/adapters/prisma/client.js';
import { prisma } from './prisma-cli.js';

/**
 * The database the global setup migrates once per Postgres container; every
 * migrated database a test asks for is a copy of it. Migrating each test
 * file's database itself started a Prisma CLI over every migration in every
 * worker at once, and under a full run that load took the tests' own time
 * (#499).
 */
export const MIGRATED_TEMPLATE = 'aeolus_test_migrated_template';

/** The URL of the named database on the server the admin URL points at. */
export function databaseUrlOf(adminUrl: string, name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Creates the template with `prisma migrate deploy`, as an installation migrates. */
export async function createMigratedTemplate(adminUrl: string): Promise<void> {
  const admin = createPrismaClient(adminUrl);
  try {
    // The name is a constant of this file, never outside input.
    await admin.$executeRawUnsafe(`CREATE DATABASE ${MIGRATED_TEMPLATE}`);
  } finally {
    await admin.$disconnect();
  }
  await prisma(databaseUrlOf(adminUrl, MIGRATED_TEMPLATE), 'migrate', 'deploy');
}
