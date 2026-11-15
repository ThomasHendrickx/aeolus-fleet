/** The metadata fill index builds after start and never holds core open on shutdown (#1854). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

const INDEX_TEST_MS = 60_000;
const CLOSE_WITHIN_MS = 5_000;
const INDEX_BUILT_MS = 30_000;
const NO_OVERDUE_PASS_MS = 600_000;
let core: PostgresCore;

function createCore() {
  return createApp({ databaseUrl: core.databaseUrl, publicUrl: 'http://localhost', clock: core.clock, logger: false, overduePassMs: NO_OVERDUE_PASS_MS });
}

/** A lock that holds a concurrent index build, while reads and writes remain possible. */
async function holdIndexBuildLock(): Promise<{ release: () => Promise<void> }> {
  await core.prisma.$executeRaw`DROP INDEX CONCURRENTLY IF EXISTS messages_unfilled_questions_idx`;
  const reached = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  const blocker = core.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`LOCK TABLE messages IN SHARE UPDATE EXCLUSIVE MODE`;
    reached.resolve(undefined);
    await released.promise;
  }, { timeout: INDEX_TEST_MS });
  void blocker.catch(reached.reject);
  await reached.promise;
  return { release: async () => {
    released.resolve(undefined);
    await blocker;
  } };
}

async function isIndexBuildRunning(isOnlyWaiting = false): Promise<boolean | undefined> {
  const [row] = await core.prisma.$queryRaw<{ isRunning: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
      AND query LIKE '%CREATE INDEX CONCURRENTLY IF NOT EXISTS%messages_unfilled_questions_idx%'
      AND pid <> pg_backend_pid() AND state = 'active' AND (NOT ${isOnlyWaiting} OR wait_event_type = 'Lock')) AS "isRunning"`;
  return row?.isRunning;
}

beforeAll(async () => { core = await createPostgresCore(); });
afterAll(async () => { await core.close(); });

describe('the metadata fill index after start', () => {
  it('closes without waiting for its metadata fill index build', async () => {
    // Given core serving while its metadata fill index waits on a table lock.
    const lock = await holdIndexBuildLock();
    const server = createCore();
    const closed = Promise.withResolvers<'closed'>();
    try {
      await server.listen({ host: '127.0.0.1', port: 0 });
      await expect.poll(() => isIndexBuildRunning(true)).toBe(true);
      expect((await server.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);

      // When core closes while the lock is still held.
      void server.close().then(() => { closed.resolve('closed'); }, closed.reject);

      // Then it closes promptly and the build no longer runs.
      const timedOut = new Promise<'timed out'>((resolve) => setTimeout(() => { resolve('timed out'); }, CLOSE_WITHIN_MS));
      expect(await Promise.race([closed.promise, timedOut])).toBe('closed');
      expect(await isIndexBuildRunning()).toBe(false);
    } finally {
      await lock.release();
      await server.close();
      await closed.promise;
    }
  }, INDEX_TEST_MS);

});
