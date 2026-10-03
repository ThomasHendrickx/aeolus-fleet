import { afterEach, describe, expect, it } from 'vitest';

import { acquireProcessLock, type ProcessLock } from '../src/adapters/prisma/process-lock.js';
import { createSquadronsDatabase } from './support/database.js';

// One squadrons process at a time: two share the flagships and would overwrite
// each other, so a second process on the same database does not start.

const held: ProcessLock[] = [];

afterEach(async () => {
  await Promise.all(held.splice(0).map((lock) => lock.release()));
});

async function lockOf(databaseUrl: string): Promise<ProcessLock | null> {
  const lock = await acquireProcessLock(databaseUrl, { onLost: () => undefined });
  if (lock) {
    held.push(lock);
  }
  return lock;
}

describe('the squadrons process lock', () => {
  it('is refused to a second process while the first holds it', async () => {
    const databaseUrl = await createSquadronsDatabase();

    await expect(lockOf(databaseUrl)).resolves.not.toBeNull();
    await expect(lockOf(databaseUrl)).resolves.toBeNull();
  });

  it('is free again once the first process lets it go', async () => {
    const databaseUrl = await createSquadronsDatabase();
    const first = await lockOf(databaseUrl);
    await first?.release();
    held.splice(0);

    await expect(lockOf(databaseUrl)).resolves.not.toBeNull();
  });

  it('is held per database: squadrons on another database starts', async () => {
    await expect(lockOf(await createSquadronsDatabase())).resolves.not.toBeNull();
    await expect(lockOf(await createSquadronsDatabase())).resolves.not.toBeNull();
  });
});
