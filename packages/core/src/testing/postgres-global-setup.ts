import { randomUUID } from 'node:crypto';

import type { TestProject } from 'vitest/node';

import { POSTGRES_IMAGE, REAPER_IMAGE } from './container-images.js';
import { startContainerSweeper } from './container-sweeper.js';
import { TestPostgres } from './postgres-container.js';
import { createMigratedTemplate } from './migrated-template.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Admin URL of the Postgres container shared by the integration tests. */
    postgresUrl: string;
    /** The test run, the label value of every container it starts, for its sweeper to remove them. */
    testRun: string;
  }
}

/**
 * Starts one Postgres for the integration project. Each test file creates its
 * own database in it (see database.ts), so files stay isolated; a
 * migrated one is a copy of the template migrated here, before any test runs.
 * Testcontainers reads the reaper image from the environment when it starts
 * the first container; a reaper image set from outside wins. The run's sweeper
 * starts before any container, so a run that never reaches its teardown still
 * leaves none behind.
 */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  process.env.RYUK_CONTAINER_IMAGE ??= REAPER_IMAGE;
  const run = randomUUID();
  startContainerSweeper(run);
  project.provide('testRun', run);
  const container = await new TestPostgres(POSTGRES_IMAGE, run).start();
  await createMigratedTemplate(container.getConnectionUri());
  project.provide('postgresUrl', container.getConnectionUri());

  return async () => {
    await container.stop();
  };
}
