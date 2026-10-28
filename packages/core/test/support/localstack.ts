import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { LOCALSTACK_IMAGE } from '../../src/testing/container-images.js';

const KMS_PORT = 4566;

/**
 * LocalStack with its KMS alone, waited for by its log. Its image checks its
 * health every 10 s, and on rootless Podman each run is a systemd unit of its
 * own (#554), so the container is created with no health check.
 */
class TestLocalStack extends GenericContainer {
  constructor() {
    super(LOCALSTACK_IMAGE);
    this.withEnvironment({ SERVICES: 'kms' });
    this.withExposedPorts(KMS_PORT);
    this.withWaitStrategy(Wait.forLogMessage(/^Ready\.$/m));
  }

  protected override async beforeContainerCreated(): Promise<void> {
    this.createOpts.Healthcheck = { Test: ['NONE'] };
    await super.beforeContainerCreated?.();
  }
}

export interface StartedLocalStack {
  readonly kmsEndpoint: string;
  stop(): Promise<void>;
}

export async function startLocalStack(): Promise<StartedLocalStack> {
  const container: StartedTestContainer = await new TestLocalStack().start();
  return {
    kmsEndpoint: `http://${container.getHost()}:${String(container.getMappedPort(KMS_PORT))}`,
    stop: async () => {
      await container.stop();
    },
  };
}
