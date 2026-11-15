import { describe, expect, it } from 'vitest';

import { POSTGRES_IMAGE } from '../src/testing/container-images.js';
import { TestPostgres } from '../src/testing/postgres-container.js';

/** The test Postgres, showing the health check it is created with after the module set its own. */
class CreatedTestPostgres extends TestPostgres {
  async createdHealthCheck(): Promise<string[] | undefined> {
    this.withHealthCheck({ test: ['CMD-SHELL', 'pg_isready'], interval: 250 });
    await this.beforeContainerCreated();
    return this.createOpts.Healthcheck?.Test;
  }

  createdLabels(): Record<string, string> | undefined {
    return this.createOpts.Labels;
  }

  createdCommand(): string[] | undefined {
    return this.createOpts.Cmd;
  }
}

// On rootless Podman every health check run is a systemd unit of its own (#554).
describe('the Postgres test container', () => {
  it('is created with no health check, so the container runtime runs nothing beside it while the tests run', async () => {
    const container = new CreatedTestPostgres(POSTGRES_IMAGE, 'test-run');

    await expect(container.createdHealthCheck()).resolves.toBeUndefined();
  });

  // A commit that waits for the disk waits for every other test's writes too: under a loaded run, Prisma Migrate
  // over every migration took 9 to 23 s instead of 2 (#499). Without fsync only a crash of the host loses commits.
  it('is created to flush nothing to disk, so a commit never waits for the other tests\' writes', () => {
    const container = new CreatedTestPostgres(POSTGRES_IMAGE, 'test-run');

    expect(container.createdCommand()).toEqual(['postgres', '-c', 'fsync=off']);
  });

  // The sweepers find a leaked container by these: the repository for the stale ones, the run for its own.
  it('is created with the labels of its repository and its run', () => {
    const container = new CreatedTestPostgres(POSTGRES_IMAGE, 'test-run');

    expect(container.createdLabels()).toMatchObject({
      'aeolus-fleet.repository': 'aeolus-fleet',
      'aeolus-fleet.test-run': 'test-run',
    });
  });
});
