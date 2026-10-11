import type { TestProject } from 'vitest/node';

import { POSTGRES_IMAGE, REAPER_IMAGE } from './container-images.js';
import { TestPostgres } from './postgres-container.js';
import { createMigratedTemplate } from './support/migrated-template.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Admin URL of the Postgres container shared by the integration tests. */
    postgresUrl: string;
  }
}

/**
 * Starts one Postgres for the integration project. Each test file creates its
 * own database in it (see support/database.ts), so files stay isolated; a
 * migrated one is a copy of the template migrated here, before any test runs.
 * Testcontainers reads the reaper image from the environment when it starts
 * the first container; a reaper image set from outside wins.
 */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  process.env.RYUK_CONTAINER_IMAGE ??= REAPER_IMAGE;
  const container = await new TestPostgres(POSTGRES_IMAGE).start();
  await createMigratedTemplate(container.getConnectionUri());
  project.provide('postgresUrl', container.getConnectionUri());

  return async () => {
    await container.stop();
  };
}
