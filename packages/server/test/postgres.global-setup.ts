import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Admin URL of the Postgres container shared by the integration tests. */
    postgresUrl: string;
  }
}

/**
 * Starts one Postgres for the integration project. Each test file creates its
 * own database in it (see support/database.ts), so files stay isolated.
 * Postgres 16 is the oldest version the architecture supports.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  project.provide('postgresUrl', container.getConnectionUri());

  return async () => {
    await container.stop();
  };
}
