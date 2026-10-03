import type { FleetId } from '@aeolus-fleet/common';

import { createPrismaClient } from '../../src/adapters/prisma/client.js';
import { createPrismaRepositoryStore } from '../../src/adapters/prisma/repository-store.js';
import { DEFAULT_PATH } from '../../src/core/catalogue/template-repository.js';

/**
 * Stores a template repository straight in squadrons' database, as the
 * operator's add would, so a test can read a local repository: the API takes
 * only https URLs.
 */
export async function seedRepository(databaseUrl: string, repository: { fleetId: FleetId; name: string; url: string }): Promise<void> {
  const prisma = createPrismaClient(databaseUrl);
  try {
    await createPrismaRepositoryStore(prisma).add({ ...repository, path: DEFAULT_PATH, token: null, addedAt: new Date(), lastFetch: null });
  } finally {
    await prisma.$disconnect();
  }
}
