import { describe, expect, it } from 'vitest';

import { POSTGRES_IMAGE } from './container-images.js';
import { TestPostgres } from './postgres-container.js';

/** The test Postgres, showing the health check it is created with after the module set its own. */
class CreatedTestPostgres extends TestPostgres {
  async createdHealthCheck(): Promise<string[] | undefined> {
    this.withHealthCheck({ test: ['CMD-SHELL', 'pg_isready'], interval: 250 });
    await this.beforeContainerCreated();
    return this.createOpts.Healthcheck?.Test;
  }
}

// On rootless Podman every health check run is a systemd unit of its own (#554).
describe('the Postgres test container', () => {
  it('is created with no health check, so the container runtime runs nothing beside it while the tests run', async () => {
    const container = new CreatedTestPostgres(POSTGRES_IMAGE);

    await expect(container.createdHealthCheck()).resolves.toBeUndefined();
  });
});
