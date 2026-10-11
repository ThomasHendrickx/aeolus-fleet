import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { inject } from 'vitest';

import { createPrismaClient } from '../../src/adapters/prisma/client.js';
import { databaseUrlOf, MIGRATED_TEMPLATE } from './migrated-template.js';

/** Creates an empty database in the shared Postgres container and returns its URL. */
export function createEmptyDatabase(): Promise<string> {
  return createDatabase('');
}

/**
 * Creates a database with the committed migrations applied, as `prisma
 * migrate deploy` leaves it: a copy of the template the global setup migrated.
 */
export function createMigratedDatabase(): Promise<string> {
  return createDatabase(` TEMPLATE ${MIGRATED_TEMPLATE}`);
}

/**
 * Runs a SQL file against the given database in one round trip, as
 * `prisma db execute --file` does, without starting a Prisma CLI per file.
 */
export async function executeSqlFile(databaseUrl: string, file: string): Promise<void> {
  const client = createPrismaClient(databaseUrl);
  try {
    // The file is a committed migration, never outside input.
    await client.$executeRawUnsafe(await readFile(file, 'utf8'));
  } finally {
    await client.$disconnect();
  }
}

async function createDatabase(template: string): Promise<string> {
  const adminUrl = inject('postgresUrl');
  const name = `aeolus_test_${randomBytes(6).toString('hex')}`;
  const admin = createPrismaClient(adminUrl);
  try {
    // The name is generated above and the template is a constant, never outside input.
    await admin.$executeRawUnsafe(`CREATE DATABASE ${name}${template}`);
  } finally {
    await admin.$disconnect();
  }
  return databaseUrlOf(adminUrl, name);
}
