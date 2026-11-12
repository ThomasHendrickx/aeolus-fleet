import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

import { getContainerRuntimeClient } from 'testcontainers';
import { describe, expect, inject, it } from 'vitest';

import { POSTGRES_IMAGE } from '../src/testing/container-images.js';
import { TEST_RUN_LABEL } from '../src/testing/container-sweeper.js';
import { TestPostgres } from '../src/testing/postgres-container.js';

const SWEEPER = new URL('../src/testing/container-sweeper.ts', import.meta.url).href;

/** Waits long enough for a Postgres to start on a loaded machine, and for the sweeper to remove it. */
const CONTAINER_TIMEOUT = 120_000;

async function dockerode() {
  return (await getContainerRuntimeClient()).container.dockerode;
}

async function containersOf(run: string): Promise<string[]> {
  const containers = await (await dockerode()).listContainers({ all: true, filters: { label: [`${TEST_RUN_LABEL}=${run}`] } });
  return containers.map((container) => container.Id);
}

async function volumesOf(containerId: string): Promise<string[]> {
  const inspected = await (await dockerode()).getContainer(containerId).inspect();
  return inspected.Mounts.flatMap((mount) => (mount.Type === 'volume' && mount.Name ? [mount.Name] : []));
}

async function existingVolumes(names: readonly string[]): Promise<string[]> {
  const docker = await dockerode();
  const found = await Promise.all(
    names.map(async (name) => {
      try {
        await docker.getVolume(name).inspect();
        return [name];
      } catch {
        return [];
      }
    }),
  );
  return found.flat();
}

/** A test run's process: it starts the sweeper for its run, then waits to be killed, as a run interrupted mid-test. */
async function startRunProcess(run: string): Promise<ChildProcess> {
  const script = `import { startContainerSweeper } from ${JSON.stringify(SWEEPER)}; startContainerSweeper(process.argv[1]); console.log('sweeping'); setInterval(() => {}, 60_000);`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script, run], { stdio: ['ignore', 'pipe', 'inherit'] });
  const [line] = (await once(child.stdout, 'data')) as [Buffer];
  expect(line.toString().trim()).toBe('sweeping');
  return child;
}

// Rootless Podman often runs no reaper, so a run's own teardown and its sweeper are all that remove its containers (#1581).
describe('the containers of a test run', () => {
  it(
    'are removed with their volumes when the run is killed before its teardown',
    async () => {
      const run = `test-${randomUUID()}`;
      const runProcess = await startRunProcess(run);
      const postgres = await new TestPostgres(POSTGRES_IMAGE, run).start();
      const volumes = await volumesOf(postgres.getId());
      expect(volumes).not.toEqual([]);

      runProcess.kill('SIGKILL');

      await expect.poll(() => containersOf(run), { timeout: 60_000, interval: 500 }).toEqual([]);
      await expect.poll(() => existingVolumes(volumes), { timeout: 30_000, interval: 500 }).toEqual([]);
    },
    CONTAINER_TIMEOUT,
  );

  it(
    'leave no Postgres volume behind when a teardown stops them',
    async () => {
      const run = `test-${randomUUID()}`;
      const postgres = await new TestPostgres(POSTGRES_IMAGE, run).start();
      const volumes = await volumesOf(postgres.getId());
      expect(volumes).not.toEqual([]);

      await postgres.stop();

      expect(await containersOf(run)).toEqual([]);
      expect(await existingVolumes(volumes)).toEqual([]);
    },
    CONTAINER_TIMEOUT,
  );

  it('include the shared Postgres the global setup starts, so its sweeper removes it', async () => {
    const containers = await (await dockerode()).listContainers({ filters: { label: [`${TEST_RUN_LABEL}=${inject('testRun')}`] } });

    expect(containers.map((container) => container.Image)).toContain(POSTGRES_IMAGE);
  });
});
